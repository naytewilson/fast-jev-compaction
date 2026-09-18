import type { Digest256 } from './identity.js';
import {
  joinCalibrationReplay,
  type CalibrationReplaySample,
  type SemanticReplayPrediction,
} from './calibration-replay.js';
import type { SemanticCalibrationLabel } from './semantic-label.js';
import {
  applyIsotonicCalibration,
  fitIsotonicCalibration,
  type IsotonicCalibrationModel,
} from './isotonic-calibrator.js';
import {
  brierScore,
  expectedCalibrationError,
  negativeLogLikelihood,
  selectiveRiskCoverage,
  type BinaryCalibrationSample,
} from './calibration-metrics.js';
import {
  ProviderCalibrationArtifactRegistry,
  verifyProviderCalibrationArtifact,
  type ProviderCalibrationArtifact,
} from './calibration-artifact.js';
import {
  verifyProviderExecutionProfile,
  type ProviderExecutionProfile,
} from './provider-profile.js';
import { sha256Digest } from './recovery.js';
import { MAPPED_OBSERVATION_AXES } from './types.js';

export interface CalibrationEvidenceCompilerInput {
  providerProfile: ProviderExecutionProfile;
  decisionContractDigest: Digest256;
  compiledProgramDigest: Digest256;
  samplingPolicyDigest: Digest256;
  labelAuthorityPolicyDigest: Digest256;
  labelBindingDigest: Digest256;
  trainingLabels: readonly SemanticCalibrationLabel[];
  trainingPredictions: readonly SemanticReplayPrediction[];
  holdoutLabels: readonly SemanticCalibrationLabel[];
  holdoutPredictions: readonly SemanticReplayPrediction[];
  confidenceFloor: number;
  eceBins: number;
}

export interface CompiledHoldoutMetrics {
  ece: number;
  brier: number;
  nll: number;
  selectiveRisk: number;
  coverage: number;
  sampleCount: number;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISSUE_TOKEN = Symbol('ANVIL.ProviderCalibrationBuildArtifact.v1');
const ISSUED = new WeakSet<object>();

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) throw new TypeError(`${field} must be canonical sha256`);
}

function canonicalSample(sample: CalibrationReplaySample) {
  return {
    labelId: sample.labelId,
    sourceDigest: sample.sourceDigest,
    predicateId: sample.predicateId,
    executionProfileDigest: sample.executionProfileDigest,
    observationDigest: sample.observationDigest,
    probability: sample.probability,
    target: sample.target,
  };
}

function merkleRoot(samples: readonly CalibrationReplaySample[]): Digest256 {
  if (samples.length === 0) throw new TypeError('calibration split must not be empty');
  let level = [...samples]
    .sort((a, b) => a.labelId.localeCompare(b.labelId))
    .map((sample) =>
      sha256Digest(JSON.stringify({
        schema: 'anvil.calibration-merkle-leaf.v1',
        ...canonicalSample(sample),
      })));

  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      next.push(sha256Digest(JSON.stringify({
        schema: 'anvil.calibration-merkle-node.v1',
        left,
        right,
      })));
    }
    level = next;
  }
  return level[0];
}

function requireCompletePredicates(
  samples: readonly CalibrationReplaySample[],
  split: string,
): void {
  const present = new Set(samples.map((sample) => sample.predicateId));
  if (
    present.size !== MAPPED_OBSERVATION_AXES.length ||
    MAPPED_OBSERVATION_AXES.some((predicate) => !present.has(predicate))
  ) {
    throw new Error(`${split} calibration evidence must contain all four registered semantic predicates`);
  }
}

function requireProviderNamespace(
  samples: readonly CalibrationReplaySample[],
  providerProfileDigest: string,
  split: string,
): void {
  for (const sample of samples) {
    if (sample.executionProfileDigest !== providerProfileDigest) {
      throw new Error(`${split} execution profile does not match provider profile digest`);
    }
  }
}

function fitBundle(
  training: readonly CalibrationReplaySample[],
): readonly IsotonicCalibrationModel[] {
  return Object.freeze(
    MAPPED_OBSERVATION_AXES.map((predicate) =>
      fitIsotonicCalibration(
        training.filter((sample) => sample.predicateId === predicate),
      )),
  );
}

function calibratedHoldout(
  holdout: readonly CalibrationReplaySample[],
  models: readonly IsotonicCalibrationModel[],
  confidenceFloor: number,
): BinaryCalibrationSample[] {
  const byPredicate = new Map(models.map((model) => [model.predicateId, model]));
  return holdout.map((sample) => {
    const model = byPredicate.get(sample.predicateId);
    if (model === undefined) throw new Error(`missing calibrator for ${sample.predicateId}`);
    const probability = applyIsotonicCalibration(model, sample.probability);
    return {
      probability,
      outcome: sample.target,
      selected:
        probability >= confidenceFloor ||
        probability <= 1 - confidenceFloor,
    };
  });
}

function computeBuildDigest(input: {
  providerProfileDigest: Digest256;
  trainingMerkleRoot: Digest256;
  holdoutMerkleRoot: Digest256;
  datasetGenerationDigest: Digest256;
  artifactDigest: Digest256;
  confidenceFloor: number;
  eceBins: number;
  trainingSampleCount: number;
  holdoutMetrics: CompiledHoldoutMetrics;
}): Digest256 {
  return sha256Digest(JSON.stringify({
    schema: 'anvil.provider-calibration-build.v1',
    ...input,
  }));
}

export class ProviderCalibrationBuildArtifact {
  public readonly schema = 'anvil.provider-calibration-build.v1' as const;

  private constructor(
    token: symbol,
    public readonly providerProfileDigest: Digest256,
    public readonly trainingMerkleRoot: Digest256,
    public readonly holdoutMerkleRoot: Digest256,
    public readonly datasetGenerationDigest: Digest256,
    public readonly calibrationArtifact: Readonly<ProviderCalibrationArtifact>,
    public readonly confidenceFloor: number,
    public readonly eceBins: number,
    public readonly trainingSampleCount: number,
    public readonly holdoutMetrics: Readonly<CompiledHoldoutMetrics>,
    public readonly buildDigest: Digest256,
  ) {
    if (token !== ISSUE_TOKEN) throw new Error('calibration build constructor is compiler protected');
    ISSUED.add(this);
    Object.freeze(this);
  }

  static issue(token: symbol, fields: {
    providerProfileDigest: Digest256;
    trainingMerkleRoot: Digest256;
    holdoutMerkleRoot: Digest256;
    datasetGenerationDigest: Digest256;
    calibrationArtifact: Readonly<ProviderCalibrationArtifact>;
    confidenceFloor: number;
    eceBins: number;
    trainingSampleCount: number;
    holdoutMetrics: Readonly<CompiledHoldoutMetrics>;
    buildDigest: Digest256;
  }): ProviderCalibrationBuildArtifact {
    if (token !== ISSUE_TOKEN) throw new Error('calibration build issuer mismatch');
    return new ProviderCalibrationBuildArtifact(
      token,
      fields.providerProfileDigest,
      fields.trainingMerkleRoot,
      fields.holdoutMerkleRoot,
      fields.datasetGenerationDigest,
      fields.calibrationArtifact,
      fields.confidenceFloor,
      fields.eceBins,
      fields.trainingSampleCount,
      fields.holdoutMetrics,
      fields.buildDigest,
    );
  }
}

export class CalibrationEvidenceCompiler {
  compile(input: CalibrationEvidenceCompilerInput): Readonly<ProviderCalibrationBuildArtifact> {
    if (!verifyProviderExecutionProfile(input.providerProfile)) {
      throw new TypeError('provider profile is not internally verifiable');
    }
    for (const [field, value] of [
      ['decisionContractDigest', input.decisionContractDigest],
      ['compiledProgramDigest', input.compiledProgramDigest],
      ['samplingPolicyDigest', input.samplingPolicyDigest],
      ['labelAuthorityPolicyDigest', input.labelAuthorityPolicyDigest],
      ['labelBindingDigest', input.labelBindingDigest],
    ] as const) requireDigest(value, field);

    if (!Number.isFinite(input.confidenceFloor) ||
        input.confidenceFloor < 0.5 ||
        input.confidenceFloor > 1) {
      throw new TypeError('confidenceFloor must be finite in [0.5,1]');
    }
    if (!Number.isSafeInteger(input.eceBins) || input.eceBins <= 0) {
      throw new TypeError('eceBins must be a positive safe integer');
    }

    const training = joinCalibrationReplay(
      input.trainingLabels,
      input.trainingPredictions,
    );
    const holdout = joinCalibrationReplay(
      input.holdoutLabels,
      input.holdoutPredictions,
    );
    requireProviderNamespace(training, input.providerProfile.providerProfileDigest, 'training');
    requireProviderNamespace(holdout, input.providerProfile.providerProfileDigest, 'holdout');
    requireCompletePredicates(training, 'training');
    requireCompletePredicates(holdout, 'holdout');

    const trainingMerkleRoot = merkleRoot(training);
    const holdoutMerkleRoot = merkleRoot(holdout);
    const datasetGenerationDigest = sha256Digest(JSON.stringify({
      schema: 'anvil.calibration-dataset-generation.v1',
      providerProfileDigest: input.providerProfile.providerProfileDigest,
      trainingMerkleRoot,
      holdoutMerkleRoot,
      samplingPolicyDigest: input.samplingPolicyDigest,
      labelAuthorityPolicyDigest: input.labelAuthorityPolicyDigest,
      labelBindingDigest: input.labelBindingDigest,
    }));

    const calibrators = fitBundle(training);
    const calibrationArtifact = new ProviderCalibrationArtifactRegistry().register({
      providerProfile: input.providerProfile,
      decisionContractDigest: input.decisionContractDigest,
      compiledProgramDigest: input.compiledProgramDigest,
      dataset: {
        trainingMerkleRoot,
        holdoutMerkleRoot,
        samplingPolicyDigest: input.samplingPolicyDigest,
        labelAuthorityPolicyDigest: input.labelAuthorityPolicyDigest,
        datasetGenerationDigest,
      },
      labelBindingDigest: input.labelBindingDigest,
      calibrators,
    });

    const calibrated = calibratedHoldout(
      holdout,
      calibrators,
      input.confidenceFloor,
    );
    const selective = selectiveRiskCoverage(calibrated);
    if (selective.risk === null || selective.selected === 0) {
      throw new Error('holdout confidence selection produced zero scored samples');
    }

    const holdoutMetrics = Object.freeze({
      ece: expectedCalibrationError(calibrated, input.eceBins),
      brier: brierScore(calibrated),
      nll: negativeLogLikelihood(calibrated),
      selectiveRisk: selective.risk,
      coverage: selective.coverage,
      sampleCount: calibrated.length,
    });
    const digestInput = {
      providerProfileDigest: input.providerProfile.providerProfileDigest,
      trainingMerkleRoot,
      holdoutMerkleRoot,
      datasetGenerationDigest,
      artifactDigest: calibrationArtifact.artifactDigest,
      confidenceFloor: input.confidenceFloor,
      eceBins: input.eceBins,
      trainingSampleCount: training.length,
      holdoutMetrics,
    };
    const buildDigest = computeBuildDigest(digestInput);

    return ProviderCalibrationBuildArtifact.issue(ISSUE_TOKEN, {
      providerProfileDigest: input.providerProfile.providerProfileDigest,
      trainingMerkleRoot,
      holdoutMerkleRoot,
      datasetGenerationDigest,
      calibrationArtifact,
      confidenceFloor: input.confidenceFloor,
      eceBins: input.eceBins,
      trainingSampleCount: training.length,
      holdoutMetrics,
      buildDigest,
    });
  }
}

export function verifyProviderCalibrationBuildArtifact(
  value: unknown,
): value is ProviderCalibrationBuildArtifact {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      !(value instanceof ProviderCalibrationBuildArtifact) ||
      !ISSUED.has(value)
    ) return false;
    const build = value as ProviderCalibrationBuildArtifact;
    if (build.schema !== 'anvil.provider-calibration-build.v1') return false;
    if (!verifyProviderCalibrationArtifact(build.calibrationArtifact)) return false;
    if (
      build.providerProfileDigest !==
      build.calibrationArtifact.providerProfileDigest
    ) return false;
    requireDigest(build.trainingMerkleRoot, 'trainingMerkleRoot');
    requireDigest(build.holdoutMerkleRoot, 'holdoutMerkleRoot');
    requireDigest(build.datasetGenerationDigest, 'datasetGenerationDigest');
    requireDigest(build.buildDigest, 'buildDigest');

    return computeBuildDigest({
      providerProfileDigest: build.providerProfileDigest,
      trainingMerkleRoot: build.trainingMerkleRoot,
      holdoutMerkleRoot: build.holdoutMerkleRoot,
      datasetGenerationDigest: build.datasetGenerationDigest,
      artifactDigest: build.calibrationArtifact.artifactDigest,
      confidenceFloor: build.confidenceFloor,
      eceBins: build.eceBins,
      trainingSampleCount: build.trainingSampleCount,
      holdoutMetrics: build.holdoutMetrics,
    }) === build.buildDigest;
  } catch {
    return false;
  }
}
