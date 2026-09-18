import {
  deriveCalibrationIdentity,
  digestTaggedIdentity,
  type Digest256,
  type TaggedIdentityComponent,
} from './identity.js';
import { deriveCalibrationDatasetIdentity } from './calibration-data.js';
import type {
  IsotonicCalibrationBlock,
  IsotonicCalibrationModel,
} from './isotonic-calibrator.js';
import {
  verifyProviderExecutionProfile,
  type ProviderExecutionProfile,
} from './provider-profile.js';
import { sha256Digest } from './recovery.js';
import {
  MAPPED_OBSERVATION_AXES,
  type MappedObservationAxis,
} from './types.js';

export interface CalibrationDatasetComponents {
  trainingMerkleRoot: Digest256;
  holdoutMerkleRoot: Digest256;
  samplingPolicyDigest: Digest256;
  labelAuthorityPolicyDigest: Digest256;
  datasetGenerationDigest: Digest256;
}

export interface ProviderCalibrationArtifactInput {
  providerProfile: ProviderExecutionProfile;
  decisionContractDigest: Digest256;
  compiledProgramDigest: Digest256;
  dataset: CalibrationDatasetComponents;
  labelBindingDigest: Digest256;
  calibrators: readonly IsotonicCalibrationModel[];
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISSUE_TOKEN = Symbol('ANVIL.ProviderCalibrationArtifact.v1');
const ISSUED = new WeakSet<object>();
const ISOTONIC_SPEC_DIGEST = sha256Digest(JSON.stringify({
  schema: 'anvil.isotonic-calibrator.v1',
  algorithm: 'pool-adjacent-violators',
  equalRawProbabilityPolicy: 'aggregate-before-pav',
  applyPolicy: 'piecewise-step-boundary-clamp',
}));

function requireDigest(value: string, field: string): Uint8Array {
  if (!DIGEST.test(value)) throw new TypeError(`${field} must be canonical sha256`);
  return Buffer.from(value.slice('sha256:'.length), 'hex');
}

function validateDataset(dataset: CalibrationDatasetComponents): void {
  requireDigest(dataset.trainingMerkleRoot, 'trainingMerkleRoot');
  requireDigest(dataset.holdoutMerkleRoot, 'holdoutMerkleRoot');
  requireDigest(dataset.samplingPolicyDigest, 'samplingPolicyDigest');
  requireDigest(dataset.labelAuthorityPolicyDigest, 'labelAuthorityPolicyDigest');
  requireDigest(dataset.datasetGenerationDigest, 'datasetGenerationDigest');
}

function cloneBlock(block: IsotonicCalibrationBlock): Readonly<IsotonicCalibrationBlock> {
  return Object.freeze({ ...block });
}

function validateAndCloneCalibrator(
  model: IsotonicCalibrationModel,
  expectedProviderProfileDigest: string,
): Readonly<IsotonicCalibrationModel> {
  if (model.schema !== 'anvil.isotonic-calibrator.v1') {
    throw new TypeError('calibrator schema mismatch');
  }
  if (!Number.isSafeInteger(model.sampleCount) || model.sampleCount <= 0) {
    throw new TypeError('calibrator sampleCount must be positive');
  }
  requireDigest(model.executionProfileDigest, 'calibrator executionProfileDigest');
  requireDigest(model.calibratorSpecDigest, 'calibratorSpecDigest');
  requireDigest(model.fittedParametersDigest, 'fittedParametersDigest');
  if (model.executionProfileDigest !== expectedProviderProfileDigest) {
    throw new Error('calibrator provider profile mismatch');
  }
  if (!MAPPED_OBSERVATION_AXES.includes(model.predicateId)) {
    throw new TypeError('calibrator predicate is not registered');
  }
  if (model.calibratorSpecDigest !== ISOTONIC_SPEC_DIGEST) {
    throw new Error('calibrator spec digest mismatch');
  }
  if (!Array.isArray(model.blocks) || model.blocks.length === 0) {
    throw new TypeError('calibrator blocks must not be empty');
  }

  let previousMax = -1;
  let previousCalibrated = -1;
  let samples = 0;
  const blocks = model.blocks.map((block) => {
    for (const value of [
      block.minRawProbability,
      block.maxRawProbability,
      block.calibratedProbability,
    ]) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new TypeError('calibrator probabilities must be finite in [0,1]');
      }
    }
    if (block.minRawProbability > block.maxRawProbability) {
      throw new Error('calibrator block range is inverted');
    }
    if (block.minRawProbability <= previousMax) {
      throw new Error('calibrator block ranges must be strictly ordered');
    }
    if (block.calibratedProbability < previousCalibrated) {
      throw new Error('calibrator probabilities must be monotonic');
    }
    if (!Number.isSafeInteger(block.sampleCount) || block.sampleCount <= 0) {
      throw new TypeError('calibrator block sampleCount must be positive');
    }
    previousMax = block.maxRawProbability;
    previousCalibrated = block.calibratedProbability;
    samples += block.sampleCount;
    return cloneBlock(block);
  });
  if (samples !== model.sampleCount) {
    throw new Error('calibrator sample count does not match blocks');
  }

  const core = {
    schema: 'anvil.isotonic-calibrator.v1' as const,
    sampleCount: model.sampleCount,
    executionProfileDigest: model.executionProfileDigest,
    predicateId: model.predicateId,
    blocks: Object.freeze(blocks),
    calibratorSpecDigest: model.calibratorSpecDigest,
  };
  const expectedFitted = sha256Digest(JSON.stringify(core));
  if (expectedFitted !== model.fittedParametersDigest) {
    throw new Error('calibrator fitted parameters digest mismatch');
  }

  return Object.freeze({
    ...core,
    fittedParametersDigest: model.fittedParametersDigest,
  });
}

function canonicalizeCalibrators(
  calibrators: readonly IsotonicCalibrationModel[],
  providerProfileDigest: string,
): readonly Readonly<IsotonicCalibrationModel>[] {
  if (calibrators.length !== MAPPED_OBSERVATION_AXES.length) {
    throw new Error('calibration artifact requires exactly four registered semantic predicates');
  }
  const byPredicate = new Map<MappedObservationAxis, Readonly<IsotonicCalibrationModel>>();
  for (const model of calibrators) {
    const cloned = validateAndCloneCalibrator(model, providerProfileDigest);
    if (byPredicate.has(cloned.predicateId)) {
      throw new Error(`duplicate calibration predicate ${cloned.predicateId}`);
    }
    byPredicate.set(cloned.predicateId, cloned);
  }

  const ordered = MAPPED_OBSERVATION_AXES.map((predicate) => {
    const model = byPredicate.get(predicate);
    if (model === undefined) throw new Error(`missing calibration predicate ${predicate}`);
    return model;
  });
  return Object.freeze(ordered);
}

interface DerivedArtifactFields {
  calibrationDatasetIdentity: Digest256;
  calibrationIdentity: Digest256;
  calibratorBundleSpecDigest: Digest256;
  fittedParameterBundleDigest: Digest256;
  artifactDigest: Digest256;
  calibrators: readonly Readonly<IsotonicCalibrationModel>[];
}

function deriveArtifactFields(input: ProviderCalibrationArtifactInput): DerivedArtifactFields {
  if (!verifyProviderExecutionProfile(input.providerProfile)) {
    throw new TypeError('provider profile is not internally verifiable');
  }
  requireDigest(input.decisionContractDigest, 'decisionContractDigest');
  requireDigest(input.compiledProgramDigest, 'compiledProgramDigest');
  requireDigest(input.labelBindingDigest, 'labelBindingDigest');
  validateDataset(input.dataset);

  const calibrators = canonicalizeCalibrators(
    input.calibrators,
    input.providerProfile.providerProfileDigest,
  );
  const calibratorBundleSpecDigest = sha256Digest(JSON.stringify({
    schema: 'anvil.calibrator-spec-bundle.v1',
    entries: calibrators.map((model) => ({
      predicateId: model.predicateId,
      calibratorSpecDigest: model.calibratorSpecDigest,
    })),
  }));
  const fittedParameterBundleDigest = sha256Digest(JSON.stringify({
    schema: 'anvil.fitted-parameter-bundle.v1',
    entries: calibrators.map((model) => ({
      predicateId: model.predicateId,
      fittedParametersDigest: model.fittedParametersDigest,
    })),
  }));
  const calibrationDatasetIdentity = deriveCalibrationDatasetIdentity(input.dataset);
  const calibrationIdentity = deriveCalibrationIdentity({
    decisionContractDigest: input.decisionContractDigest,
    compiledProgramDigest: input.compiledProgramDigest,
    executionSemanticsDigest: input.providerProfile.executionSemanticsDigest,
    modelIdentityDigest: input.providerProfile.modelIdentityDigest,
    normalizerDigest: input.providerProfile.normalizerDigest,
    trainingMerkleRoot: input.dataset.trainingMerkleRoot,
    holdoutMerkleRoot: input.dataset.holdoutMerkleRoot,
    samplingPolicyDigest: input.dataset.samplingPolicyDigest,
    labelAuthorityPolicyDigest: input.dataset.labelAuthorityPolicyDigest,
    datasetGenerationDigest: input.dataset.datasetGenerationDigest,
    labelBindingDigest: input.labelBindingDigest,
    calibratorSpecDigest: calibratorBundleSpecDigest,
    fittedParametersDigest: fittedParameterBundleDigest,
  });

  const components: TaggedIdentityComponent[] = [
    { tag: 1, data: requireDigest(input.providerProfile.providerProfileDigest, 'providerProfileDigest') },
    { tag: 2, data: requireDigest(input.providerProfile.observationABIDigest, 'observationABIDigest') },
    { tag: 3, data: requireDigest(calibrationDatasetIdentity, 'calibrationDatasetIdentity') },
    { tag: 4, data: requireDigest(calibrationIdentity, 'calibrationIdentity') },
    { tag: 5, data: requireDigest(calibratorBundleSpecDigest, 'calibratorBundleSpecDigest') },
    { tag: 6, data: requireDigest(fittedParameterBundleDigest, 'fittedParameterBundleDigest') },
  ];
  const artifactDigest = digestTaggedIdentity(
    'ANVIL.ProviderCalibrationArtifact.v1',
    components,
  );

  return {
    calibrationDatasetIdentity,
    calibrationIdentity,
    calibratorBundleSpecDigest,
    fittedParameterBundleDigest,
    artifactDigest,
    calibrators,
  };
}

export class ProviderCalibrationArtifact {
  public readonly schema = 'anvil.provider-calibration-artifact.v1' as const;

  private constructor(
    token: symbol,
    public readonly providerProfile: Readonly<ProviderExecutionProfile>,
    public readonly providerId: string,
    public readonly providerProfileDigest: Digest256,
    public readonly decisionContractDigest: Digest256,
    public readonly compiledProgramDigest: Digest256,
    public readonly dataset: Readonly<CalibrationDatasetComponents>,
    public readonly labelBindingDigest: Digest256,
    public readonly calibrators: readonly Readonly<IsotonicCalibrationModel>[],
    public readonly calibrationDatasetIdentity: Digest256,
    public readonly calibrationIdentity: Digest256,
    public readonly calibratorBundleSpecDigest: Digest256,
    public readonly fittedParameterBundleDigest: Digest256,
    public readonly artifactDigest: Digest256,
  ) {
    if (token !== ISSUE_TOKEN) throw new Error('calibration artifact constructor is registry protected');
    ISSUED.add(this);
    Object.freeze(this);
  }

  static issue(
    token: symbol,
    input: ProviderCalibrationArtifactInput,
    derived: DerivedArtifactFields,
  ): ProviderCalibrationArtifact {
    if (token !== ISSUE_TOKEN) throw new Error('calibration artifact issuer mismatch');
    return new ProviderCalibrationArtifact(
      token,
      Object.freeze({ ...input.providerProfile }),
      input.providerProfile.providerId,
      input.providerProfile.providerProfileDigest,
      input.decisionContractDigest,
      input.compiledProgramDigest,
      Object.freeze({ ...input.dataset }),
      input.labelBindingDigest,
      derived.calibrators,
      derived.calibrationDatasetIdentity,
      derived.calibrationIdentity,
      derived.calibratorBundleSpecDigest,
      derived.fittedParameterBundleDigest,
      derived.artifactDigest,
    );
  }
}

export class ProviderCalibrationArtifactRegistry {
  private readonly artifacts = new Map<string, ProviderCalibrationArtifact>();

  register(input: ProviderCalibrationArtifactInput): Readonly<ProviderCalibrationArtifact> {
    const derived = deriveArtifactFields(input);
    if (this.artifacts.has(derived.artifactDigest)) {
      throw new Error(`duplicate calibration artifact ${derived.artifactDigest}`);
    }
    const artifact = ProviderCalibrationArtifact.issue(ISSUE_TOKEN, input, derived);
    this.artifacts.set(artifact.artifactDigest, artifact);
    return artifact;
  }
}

export function verifyProviderCalibrationArtifact(
  value: unknown,
): value is ProviderCalibrationArtifact {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      !(value instanceof ProviderCalibrationArtifact) ||
      !ISSUED.has(value)
    ) return false;
    const artifact = value as ProviderCalibrationArtifact;
    if (artifact.schema !== 'anvil.provider-calibration-artifact.v1') return false;

    const derived = deriveArtifactFields({
      providerProfile: artifact.providerProfile,
      decisionContractDigest: artifact.decisionContractDigest,
      compiledProgramDigest: artifact.compiledProgramDigest,
      dataset: artifact.dataset,
      labelBindingDigest: artifact.labelBindingDigest,
      calibrators: artifact.calibrators,
    });

    return (
      artifact.providerId === artifact.providerProfile.providerId &&
      artifact.providerProfileDigest === artifact.providerProfile.providerProfileDigest &&
      artifact.calibrationDatasetIdentity === derived.calibrationDatasetIdentity &&
      artifact.calibrationIdentity === derived.calibrationIdentity &&
      artifact.calibratorBundleSpecDigest === derived.calibratorBundleSpecDigest &&
      artifact.fittedParameterBundleDigest === derived.fittedParameterBundleDigest &&
      artifact.artifactDigest === derived.artifactDigest
    );
  } catch {
    return false;
  }
}
