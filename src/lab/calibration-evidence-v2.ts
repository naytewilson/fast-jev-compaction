import type { Digest256 } from './identity.js';
import {
  joinCalibrationReplayV2,
  type CalibrationReplaySampleV2,
  type SemanticReplayPredictionV2,
} from './calibration-replay-v2.js';
import type { SemanticCalibrationLabelV2 } from './semantic-label-v2.js';
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
  ProviderCalibrationArtifactRegistryV2,
  verifyProviderCalibrationArtifactV2,
  type ProviderCalibrationArtifactV2,
} from './provider-calibration-artifact-v2.js';
import {
  verifyProviderExecutionProfile,
  type ProviderExecutionProfile,
} from './provider-profile.js';
import { sha256Digest } from './recovery.js';
import {
  MODELED_SEMANTIC_AXES_V2,
  SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
} from './semantic-contract-v2.js';

export interface CalibrationEvidenceCompilerV2Input {
  providerProfile: ProviderExecutionProfile;
  decisionContractDigest: Digest256;
  compiledProgramDigest: Digest256;
  samplingPolicyDigest: Digest256;
  labelAuthorityPolicyDigest: Digest256;
  labelBindingDigest: Digest256;
  trainingLabels: readonly SemanticCalibrationLabelV2[];
  trainingPredictions: readonly SemanticReplayPredictionV2[];
  holdoutLabels: readonly SemanticCalibrationLabelV2[];
  holdoutPredictions: readonly SemanticReplayPredictionV2[];
  confidenceFloor: number;
  eceBins: number;
}

export interface CompiledHoldoutMetricsV2 {
  ece: number;
  brier: number;
  nll: number;
  selectiveRisk: number;
  coverage: number;
  sampleCount: number;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISSUE_TOKEN = Symbol('ANVIL.ProviderCalibrationBuildArtifact.v2');
const ISSUED = new WeakSet<object>();

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) {
    throw new TypeError(`${field} must be canonical sha256`);
  }
}

function canonicalSample(sample: CalibrationReplaySampleV2) {
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

function merkleRoot(
  samples: readonly CalibrationReplaySampleV2[],
): Digest256 {
  if (samples.length === 0) {
    throw new TypeError('semantic v2 calibration split must not be empty');
  }
  let level = [...samples]
    .sort((a, b) => a.labelId.localeCompare(b.labelId))
    .map((sample) =>
      sha256Digest(JSON.stringify({
        schema: 'anvil.calibration-merkle-leaf.v2',
        ...canonicalSample(sample),
      })));

  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      next.push(sha256Digest(JSON.stringify({
        schema: 'anvil.calibration-merkle-node.v2',
        left,
        right,
      })));
    }
    level = next;
  }
  return level[0];
}

function requireCompletePredicates(
  samples: readonly CalibrationReplaySampleV2[],
  split: string,
): void {
  const present = new Set(samples.map((sample) => sample.predicateId));
  if (
    present.size !== MODELED_SEMANTIC_AXES_V2.length ||
    MODELED_SEMANTIC_AXES_V2.some((predicate) => !present.has(predicate))
  ) {
    throw new Error(
      `${split} semantic v2 calibration evidence must contain all four modeled predicates`,
    );
  }
}

function requireProviderNamespace(
  samples: readonly CalibrationReplaySampleV2[],
  providerProfileDigest: string,
  split: string,
): void {
  for (const sample of samples) {
    if (sample.executionProfileDigest !== providerProfileDigest) {
      throw new Error(
        `${split} semantic v2 execution profile does not match provider profile digest`,
      );
    }
  }
}

function fitBundle(
  training: readonly CalibrationReplaySampleV2[],
): readonly IsotonicCalibrationModel[] {
  return Object.freeze(
    MODELED_SEMANTIC_AXES_V2.map((predicate) =>
      fitIsotonicCalibration(
        training.filter((sample) => sample.predicateId === predicate),
      )),
  );
}

function calibratedHoldout(
  holdout: readonly CalibrationReplaySampleV2[],
  models: readonly IsotonicCalibrationModel[],
  confidenceFloor: number,
): BinaryCalibrationSample[] {
  const byPredicate = new Map(
    models.map((model) => [model.predicateId, model]),
  );
  return holdout.map((sample) => {
    const model = byPredicate.get(sample.predicateId);
    if (model === undefined) {
      throw new Error(
        `missing semantic v2 calibrator for ${sample.predicateId}`,
      );
    }
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
  holdoutMetrics: CompiledHoldoutMetricsV2;
}): Digest256 {
  return sha256Digest(JSON.stringify({
    schema: 'anvil.provider-calibration-build.v2',
    ...input,
  }));
}

export class ProviderCalibrationBuildArtifactV2 {
  public readonly schema = 'anvil.provider-calibration-build.v2' as const;

  private constructor(
    token: symbol,
    public readonly providerProfileDigest: Digest256,
    public readonly trainingMerkleRoot: Digest256,
    public readonly holdoutMerkleRoot: Digest256,
    public readonly datasetGenerationDigest: Digest256,
    public readonly calibrationArtifact: Readonly<ProviderCalibrationArtifactV2>,
    public readonly confidenceFloor: number,
    public readonly eceBins: number,
    public readonly trainingSampleCount: number,
    public readonly holdoutMetrics: Readonly<CompiledHoldoutMetricsV2>,
    public readonly buildDigest: Digest256,
  ) {
    if (token !== ISSUE_TOKEN) {
      throw new Error('semantic v2 calibration build constructor is compiler protected');
    }
    ISSUED.add(this);
    Object.freeze(this);
  }

  static issue(token: symbol, fields: {
    providerProfileDigest: Digest256;
    trainingMerkleRoot: Digest256;
    holdoutMerkleRoot: Digest256;
    datasetGenerationDigest: Digest256;
    calibrationArtifact: Readonly<ProviderCalibrationArtifactV2>;
    confidenceFloor: number;
    eceBins: number;
    trainingSampleCount: number;
    holdoutMetrics: Readonly<CompiledHoldoutMetricsV2>;
    buildDigest: Digest256;
  }): ProviderCalibrationBuildArtifactV2 {
    if (token !== ISSUE_TOKEN) {
      throw new Error('semantic v2 calibration build issuer mismatch');
    }
    return new ProviderCalibrationBuildArtifactV2(
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

export class CalibrationEvidenceCompilerV2 {
  compile(
    input: CalibrationEvidenceCompilerV2Input,
  ): Readonly<ProviderCalibrationBuildArtifactV2> {
    if (!verifyProviderExecutionProfile(input.providerProfile)) {
      throw new TypeError('semantic v2 provider profile is not internally verifiable');
    }
    if (
      input.providerProfile.observationABIDigest !==
      SEMANTIC_OBSERVATION_ABI_DIGEST_V2
    ) {
      throw new Error('semantic v2 provider profile Observation ABI mismatch');
    }
    for (const [field, value] of [
      ['decisionContractDigest', input.decisionContractDigest],
      ['compiledProgramDigest', input.compiledProgramDigest],
      ['samplingPolicyDigest', input.samplingPolicyDigest],
      ['labelAuthorityPolicyDigest', input.labelAuthorityPolicyDigest],
      ['labelBindingDigest', input.labelBindingDigest],
    ] as const) {
      requireDigest(value, field);
    }

    if (
      !Number.isFinite(input.confidenceFloor) ||
      input.confidenceFloor < 0.5 ||
      input.confidenceFloor > 1
    ) {
      throw new TypeError('semantic v2 confidenceFloor must be finite in [0.5,1]');
    }
    if (!Number.isSafeInteger(input.eceBins) || input.eceBins <= 0) {
      throw new TypeError('semantic v2 eceBins must be a positive safe integer');
    }

    const training = joinCalibrationReplayV2(
      input.trainingLabels,
      input.trainingPredictions,
    );
    const holdout = joinCalibrationReplayV2(
      input.holdoutLabels,
      input.holdoutPredictions,
    );
    requireProviderNamespace(
      training,
      input.providerProfile.providerProfileDigest,
      'training',
    );
    requireProviderNamespace(
      holdout,
      input.providerProfile.providerProfileDigest,
      'holdout',
    );
    requireCompletePredicates(training, 'training');
    requireCompletePredicates(holdout, 'holdout');

    const trainingMerkleRoot = merkleRoot(training);
    const holdoutMerkleRoot = merkleRoot(holdout);
    const datasetGenerationDigest = sha256Digest(JSON.stringify({
      schema: 'anvil.calibration-dataset-generation.v2',
      providerProfileDigest: input.providerProfile.providerProfileDigest,
      observationABIDigest: SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
      trainingMerkleRoot,
      holdoutMerkleRoot,
      samplingPolicyDigest: input.samplingPolicyDigest,
      labelAuthorityPolicyDigest: input.labelAuthorityPolicyDigest,
      labelBindingDigest: input.labelBindingDigest,
    }));

    const calibrators = fitBundle(training);
    const calibrationArtifact =
      new ProviderCalibrationArtifactRegistryV2().register({
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
      throw new Error(
        'semantic v2 holdout confidence selection produced zero scored samples',
      );
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

    return ProviderCalibrationBuildArtifactV2.issue(ISSUE_TOKEN, {
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

export function verifyProviderCalibrationBuildArtifactV2(
  value: unknown,
): value is ProviderCalibrationBuildArtifactV2 {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      !(value instanceof ProviderCalibrationBuildArtifactV2) ||
      !ISSUED.has(value)
    ) return false;
    const build = value as ProviderCalibrationBuildArtifactV2;
    if (build.schema !== 'anvil.provider-calibration-build.v2') return false;
    if (!verifyProviderCalibrationArtifactV2(build.calibrationArtifact)) {
      return false;
    }
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
