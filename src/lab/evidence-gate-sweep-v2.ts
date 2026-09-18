import type { Digest256 } from './identity.js';
import {
  applyIsotonicCalibration,
  type IsotonicCalibrationModel,
} from './isotonic-calibrator.js';
import {
  calibrationReplayMerkleRootV2,
  verifyProviderCalibrationBuildArtifactV2,
  type ProviderCalibrationBuildArtifactV2,
} from './calibration-evidence-v2.js';
import {
  joinCalibrationReplayV2,
  type CalibrationReplaySampleV2,
  type SemanticReplayPredictionV2,
} from './calibration-replay-v2.js';
import type { SemanticCalibrationLabelV2 } from './semantic-label-v2.js';
import { sha256Digest } from './recovery.js';

export interface EvidenceSufficiencyGateSweepCompilerV2Input {
  build: ProviderCalibrationBuildArtifactV2;
  holdoutLabels: readonly SemanticCalibrationLabelV2[];
  holdoutPredictions: readonly SemanticReplayPredictionV2[];
}

export interface EvidenceGateThresholdPointV2 {
  threshold: number;
  trueSufficient: number;
  falseSufficient: number;
  trueInsufficient: number;
  falseInsufficient: number;
  falseSufficientRate: number;
  sufficientRecall: number;
  passRate: number;
}

export class EvidenceSufficiencyGateSweepArtifactV2 {
  public readonly schema =
    'anvil.evidence-sufficiency-gate-sweep.v2' as const;
  public readonly predicateId = 'evidence_sufficient' as const;
  public readonly recommendationAuthority =
    'NON_AUTHORITATIVE_STRONG_HOLDOUT' as const;
  public readonly recommendationPolicy =
    'maximize-recall-subject-to-zero-observed-false-sufficient' as const;

  private constructor(
    token: symbol,
    public readonly providerProfileDigest: Digest256,
    public readonly calibrationIdentity: Digest256,
    public readonly holdoutMerkleRoot: Digest256,
    public readonly sampleCount: number,
    public readonly positiveCount: number,
    public readonly negativeCount: number,
    public readonly points: readonly Readonly<EvidenceGateThresholdPointV2>[],
    public readonly recommendedThreshold: number | null,
    public readonly zeroFalseSufficientUpper95: number | null,
    public readonly sweepDigest: Digest256,
  ) {
    if (token !== ISSUE_TOKEN) {
      throw new Error(
        'semantic v2 evidence gate sweep constructor is compiler protected',
      );
    }
    ISSUED.add(this);
    Object.freeze(this);
  }

  static issue(token: symbol, fields: {
    providerProfileDigest: Digest256;
    calibrationIdentity: Digest256;
    holdoutMerkleRoot: Digest256;
    sampleCount: number;
    positiveCount: number;
    negativeCount: number;
    points: readonly Readonly<EvidenceGateThresholdPointV2>[];
    recommendedThreshold: number | null;
    zeroFalseSufficientUpper95: number | null;
    sweepDigest: Digest256;
  }): EvidenceSufficiencyGateSweepArtifactV2 {
    if (token !== ISSUE_TOKEN) {
      throw new Error('semantic v2 evidence gate sweep issuer mismatch');
    }
    return new EvidenceSufficiencyGateSweepArtifactV2(
      token,
      fields.providerProfileDigest,
      fields.calibrationIdentity,
      fields.holdoutMerkleRoot,
      fields.sampleCount,
      fields.positiveCount,
      fields.negativeCount,
      fields.points,
      fields.recommendedThreshold,
      fields.zeroFalseSufficientUpper95,
      fields.sweepDigest,
    );
  }
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISSUE_TOKEN = Symbol('ANVIL.EvidenceSufficiencyGateSweep.v2');
const ISSUED = new WeakSet<object>();

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) {
    throw new TypeError(`${field} must be canonical sha256`);
  }
}

function finiteUnit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function evidenceCalibrator(
  build: ProviderCalibrationBuildArtifactV2,
): IsotonicCalibrationModel {
  const model = build.calibrationArtifact.calibrators.find(
    (candidate) => candidate.predicateId === 'evidence_sufficient',
  );
  if (model === undefined) {
    throw new Error(
      'semantic v2 calibration artifact is missing evidence_sufficient calibrator',
    );
  }
  return model;
}

function calibratedEvidenceSamples(
  samples: readonly CalibrationReplaySampleV2[],
  calibrator: IsotonicCalibrationModel,
): readonly { probability: number; target: 0 | 1 }[] {
  return Object.freeze(
    samples
      .filter((sample) => sample.predicateId === 'evidence_sufficient')
      .map((sample) => Object.freeze({
        probability: applyIsotonicCalibration(
          calibrator,
          sample.probability,
        ),
        target: sample.target,
      })),
  );
}

function thresholdCandidates(
  samples: readonly { probability: number; target: 0 | 1 }[],
): readonly number[] {
  const values = [...new Set([
    0,
    1,
    ...samples.map((sample) => sample.probability),
  ])].sort((a, b) => a - b);

  const candidates = new Set<number>(values);
  for (let index = 0; index < values.length - 1; index += 1) {
    candidates.add((values[index] + values[index + 1]) / 2);
  }
  return Object.freeze([...candidates].sort((a, b) => a - b));
}

function evaluateThreshold(
  threshold: number,
  samples: readonly { probability: number; target: 0 | 1 }[],
  positiveCount: number,
  negativeCount: number,
): Readonly<EvidenceGateThresholdPointV2> {
  let trueSufficient = 0;
  let falseSufficient = 0;
  let trueInsufficient = 0;
  let falseInsufficient = 0;

  for (const sample of samples) {
    const sufficient = sample.probability >= threshold;
    if (sample.target === 1 && sufficient) trueSufficient += 1;
    else if (sample.target === 0 && sufficient) falseSufficient += 1;
    else if (sample.target === 0) trueInsufficient += 1;
    else falseInsufficient += 1;
  }

  return Object.freeze({
    threshold,
    trueSufficient,
    falseSufficient,
    trueInsufficient,
    falseInsufficient,
    falseSufficientRate:
      negativeCount === 0 ? 0 : falseSufficient / negativeCount,
    sufficientRecall:
      positiveCount === 0 ? 0 : trueSufficient / positiveCount,
    passRate:
      samples.length === 0
        ? 0
        : (trueSufficient + falseSufficient) / samples.length,
  });
}

function chooseRecommendation(
  points: readonly Readonly<EvidenceGateThresholdPointV2>[],
): Readonly<EvidenceGateThresholdPointV2> | null {
  const eligible = points.filter(
    (point) => point.falseSufficient === 0,
  );
  if (eligible.length === 0) return null;

  return [...eligible].sort((a, b) => {
    if (a.sufficientRecall !== b.sufficientRecall) {
      return b.sufficientRecall - a.sufficientRecall;
    }
    if (a.passRate !== b.passRate) {
      return b.passRate - a.passRate;
    }
    return a.threshold - b.threshold;
  })[0];
}

function sweepDigest(input: {
  providerProfileDigest: Digest256;
  calibrationIdentity: Digest256;
  holdoutMerkleRoot: Digest256;
  sampleCount: number;
  positiveCount: number;
  negativeCount: number;
  points: readonly Readonly<EvidenceGateThresholdPointV2>[];
  recommendedThreshold: number | null;
  zeroFalseSufficientUpper95: number | null;
}): Digest256 {
  return sha256Digest(JSON.stringify({
    schema: 'anvil.evidence-sufficiency-gate-sweep.v2',
    predicateId: 'evidence_sufficient',
    recommendationAuthority: 'NON_AUTHORITATIVE_STRONG_HOLDOUT',
    recommendationPolicy:
      'maximize-recall-subject-to-zero-observed-false-sufficient',
    ...input,
  }));
}

export class EvidenceSufficiencyGateSweepCompilerV2 {
  compile(
    input: EvidenceSufficiencyGateSweepCompilerV2Input,
  ): Readonly<EvidenceSufficiencyGateSweepArtifactV2> {
    if (!verifyProviderCalibrationBuildArtifactV2(input.build)) {
      throw new Error(
        'semantic v2 evidence gate sweep requires an issued calibration build artifact',
      );
    }
    if (
      input.holdoutLabels.some((label) => label.authority !== 'STRONG')
    ) {
      throw new Error(
        'semantic v2 evidence gate sweep accepts STRONG holdout labels only',
      );
    }

    const replay = joinCalibrationReplayV2(
      input.holdoutLabels,
      input.holdoutPredictions,
    );
    if (
      replay.some(
        (sample) =>
          sample.executionProfileDigest !==
          input.build.providerProfileDigest,
      )
    ) {
      throw new Error(
        'semantic v2 evidence gate sweep provider profile mismatch',
      );
    }
    const root = calibrationReplayMerkleRootV2(replay);
    if (root !== input.build.holdoutMerkleRoot) {
      throw new Error(
        'semantic v2 evidence gate sweep holdout root does not match calibration build',
      );
    }

    const samples = calibratedEvidenceSamples(
      replay,
      evidenceCalibrator(input.build),
    );
    if (samples.length === 0) {
      throw new Error(
        'semantic v2 evidence gate sweep has no evidence_sufficient holdout samples',
      );
    }

    const positiveCount = samples.filter(
      (sample) => sample.target === 1,
    ).length;
    const negativeCount = samples.length - positiveCount;
    if (positiveCount === 0 || negativeCount === 0) {
      throw new Error(
        'semantic v2 evidence gate sweep requires both sufficient and insufficient holdout labels',
      );
    }

    const points = Object.freeze(
      thresholdCandidates(samples).map((threshold) =>
        evaluateThreshold(
          threshold,
          samples,
          positiveCount,
          negativeCount,
        )),
    );
    const recommended = chooseRecommendation(points);
    const recommendedThreshold = recommended?.threshold ?? null;
    const zeroFalseSufficientUpper95 =
      recommended !== null &&
      recommended.falseSufficient === 0 &&
      negativeCount > 0
        ? 1 - Math.pow(0.05, 1 / negativeCount)
        : null;

    const core = {
      providerProfileDigest: input.build.providerProfileDigest,
      calibrationIdentity:
        input.build.calibrationArtifact.calibrationIdentity,
      holdoutMerkleRoot: input.build.holdoutMerkleRoot,
      sampleCount: samples.length,
      positiveCount,
      negativeCount,
      points,
      recommendedThreshold,
      zeroFalseSufficientUpper95,
    };
    const digest = sweepDigest(core);

    return EvidenceSufficiencyGateSweepArtifactV2.issue(
      ISSUE_TOKEN,
      {
        ...core,
        sweepDigest: digest,
      },
    );
  }
}

export function verifyEvidenceSufficiencyGateSweepArtifactV2(
  value: unknown,
): value is EvidenceSufficiencyGateSweepArtifactV2 {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      !(value instanceof EvidenceSufficiencyGateSweepArtifactV2) ||
      !ISSUED.has(value)
    ) return false;

    const sweep = value as EvidenceSufficiencyGateSweepArtifactV2;
    if (
      sweep.schema !==
      'anvil.evidence-sufficiency-gate-sweep.v2'
    ) return false;
    if (sweep.predicateId !== 'evidence_sufficient') return false;
    if (
      sweep.recommendationAuthority !==
      'NON_AUTHORITATIVE_STRONG_HOLDOUT'
    ) return false;
    if (
      sweep.recommendationPolicy !==
      'maximize-recall-subject-to-zero-observed-false-sufficient'
    ) return false;

    requireDigest(sweep.providerProfileDigest, 'providerProfileDigest');
    requireDigest(sweep.calibrationIdentity, 'calibrationIdentity');
    requireDigest(sweep.holdoutMerkleRoot, 'holdoutMerkleRoot');
    requireDigest(sweep.sweepDigest, 'sweepDigest');

    if (
      !Number.isSafeInteger(sweep.sampleCount) ||
      sweep.sampleCount <= 0 ||
      !Number.isSafeInteger(sweep.positiveCount) ||
      sweep.positiveCount <= 0 ||
      !Number.isSafeInteger(sweep.negativeCount) ||
      sweep.negativeCount <= 0 ||
      sweep.positiveCount + sweep.negativeCount !== sweep.sampleCount
    ) return false;

    for (const point of sweep.points) {
      if (!finiteUnit(point.threshold) ||
          !finiteUnit(point.falseSufficientRate) ||
          !finiteUnit(point.sufficientRecall) ||
          !finiteUnit(point.passRate)) {
        return false;
      }
      for (const count of [
        point.trueSufficient,
        point.falseSufficient,
        point.trueInsufficient,
        point.falseInsufficient,
      ]) {
        if (!Number.isSafeInteger(count) || count < 0) return false;
      }
    }
    if (
      sweep.recommendedThreshold !== null &&
      !finiteUnit(sweep.recommendedThreshold)
    ) return false;
    if (
      sweep.zeroFalseSufficientUpper95 !== null &&
      !finiteUnit(sweep.zeroFalseSufficientUpper95)
    ) return false;

    return sweepDigest({
      providerProfileDigest: sweep.providerProfileDigest,
      calibrationIdentity: sweep.calibrationIdentity,
      holdoutMerkleRoot: sweep.holdoutMerkleRoot,
      sampleCount: sweep.sampleCount,
      positiveCount: sweep.positiveCount,
      negativeCount: sweep.negativeCount,
      points: sweep.points,
      recommendedThreshold: sweep.recommendedThreshold,
      zeroFalseSufficientUpper95:
        sweep.zeroFalseSufficientUpper95,
    }) === sweep.sweepDigest;
  } catch {
    return false;
  }
}
