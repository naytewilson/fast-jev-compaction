import type { Digest256 } from './identity.js';
import {
  verifyProviderCalibrationBuildArtifactV2,
  type ProviderCalibrationBuildArtifactV2,
} from './calibration-evidence-v2.js';
import {
  verifyProviderSafetyTrialArtifact,
  type ProviderSafetyTrialArtifact,
} from './provider-safety-trial.js';
import {
  SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
} from './semantic-contract-v2.js';
import { sha256Digest } from './recovery.js';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISSUE_TOKEN = Symbol('ANVIL.CompiledArtifactPromotionEvidence.v2');
const ISSUED = new WeakSet<object>();

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) {
    throw new TypeError(`${field} must be canonical sha256`);
  }
}

function evidenceDigest(input: {
  artifactDigest: Digest256;
  buildDigest: Digest256;
  providerProfileDigest: Digest256;
  calibrationIdentity: Digest256;
  observationABIDigest: Digest256;
  safetyTrialDigest: Digest256;
  strongHoldoutSamples: number;
  falseAuthorityLeaks: number;
  ece: number;
  brier: number;
  selectiveRisk: number;
  coverage: number;
}): Digest256 {
  return sha256Digest(JSON.stringify({
    schema: 'anvil.compiled-artifact-promotion-evidence.v2',
    ...input,
  }));
}

export class CompiledArtifactPromotionEvidenceV2 {
  public readonly schema =
    'anvil.compiled-artifact-promotion-evidence.v2' as const;

  private constructor(
    token: symbol,
    public readonly artifactDigest: Digest256,
    public readonly buildDigest: Digest256,
    public readonly providerProfileDigest: Digest256,
    public readonly calibrationIdentity: Digest256,
    public readonly observationABIDigest: Digest256,
    public readonly safetyTrialDigest: Digest256,
    public readonly strongHoldoutSamples: number,
    public readonly falseAuthorityLeaks: number,
    public readonly ece: number,
    public readonly brier: number,
    public readonly selectiveRisk: number,
    public readonly coverage: number,
    public readonly evidenceDigest: Digest256,
  ) {
    if (token !== ISSUE_TOKEN) {
      throw new Error('semantic v2 promotion evidence constructor is compiler protected');
    }
    ISSUED.add(this);
    Object.freeze(this);
  }

  static issue(token: symbol, fields: {
    artifactDigest: Digest256;
    buildDigest: Digest256;
    providerProfileDigest: Digest256;
    calibrationIdentity: Digest256;
    observationABIDigest: Digest256;
    safetyTrialDigest: Digest256;
    strongHoldoutSamples: number;
    falseAuthorityLeaks: number;
    ece: number;
    brier: number;
    selectiveRisk: number;
    coverage: number;
    evidenceDigest: Digest256;
  }): CompiledArtifactPromotionEvidenceV2 {
    if (token !== ISSUE_TOKEN) {
      throw new Error('semantic v2 promotion evidence issuer mismatch');
    }
    return new CompiledArtifactPromotionEvidenceV2(
      token,
      fields.artifactDigest,
      fields.buildDigest,
      fields.providerProfileDigest,
      fields.calibrationIdentity,
      fields.observationABIDigest,
      fields.safetyTrialDigest,
      fields.strongHoldoutSamples,
      fields.falseAuthorityLeaks,
      fields.ece,
      fields.brier,
      fields.selectiveRisk,
      fields.coverage,
      fields.evidenceDigest,
    );
  }
}

export class ArtifactPromotionEvidenceCompilerV2 {
  compile(
    build: ProviderCalibrationBuildArtifactV2,
    safety: ProviderSafetyTrialArtifact,
  ): Readonly<CompiledArtifactPromotionEvidenceV2> {
    if (!verifyProviderCalibrationBuildArtifactV2(build)) {
      throw new Error(
        'semantic v2 promotion evidence requires an issued calibration build artifact',
      );
    }
    if (!verifyProviderSafetyTrialArtifact(safety)) {
      throw new Error(
        'semantic v2 promotion evidence requires an issued provider safety trial artifact',
      );
    }
    if (safety.evidenceAuthority !== 'MEASURED_SHADOW') {
      throw new Error(
        'semantic v2 promotion evidence requires MEASURED_SHADOW authoritative safety evidence',
      );
    }
    if (
      build.calibrationArtifact.providerProfile.observationABIDigest !==
      SEMANTIC_OBSERVATION_ABI_DIGEST_V2
    ) {
      throw new Error(
        'semantic v2 calibration build does not bind the canonical Observation ABI',
      );
    }
    if (
      safety.observationABIDigest !==
      SEMANTIC_OBSERVATION_ABI_DIGEST_V2
    ) {
      throw new Error(
        'semantic v2 safety evidence Observation ABI mismatch',
      );
    }
    if (build.providerProfileDigest !== safety.providerProfileDigest) {
      throw new Error(
        'semantic v2 provider profile mismatch between calibration and safety evidence',
      );
    }
    if (
      build.calibrationArtifact.calibrationIdentity !==
      safety.calibrationIdentity
    ) {
      throw new Error(
        'semantic v2 calibration identity mismatch between build and safety evidence',
      );
    }
    if (safety.result.falseAuthority.opportunities <= 0) {
      throw new Error(
        'semantic v2 safety evidence has no false-authority opportunities',
      );
    }

    const metrics = build.holdoutMetrics;
    const core = {
      artifactDigest: build.calibrationArtifact.artifactDigest,
      buildDigest: build.buildDigest,
      providerProfileDigest: build.providerProfileDigest,
      calibrationIdentity: build.calibrationArtifact.calibrationIdentity,
      observationABIDigest: SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
      safetyTrialDigest: safety.trialDigest,
      strongHoldoutSamples: metrics.sampleCount,
      falseAuthorityLeaks: safety.result.falseAuthority.leaks,
      ece: metrics.ece,
      brier: metrics.brier,
      selectiveRisk: metrics.selectiveRisk,
      coverage: metrics.coverage,
    };
    const digest = evidenceDigest(core);

    return CompiledArtifactPromotionEvidenceV2.issue(ISSUE_TOKEN, {
      ...core,
      evidenceDigest: digest,
    });
  }
}

export function verifyCompiledArtifactPromotionEvidenceV2(
  value: unknown,
): value is CompiledArtifactPromotionEvidenceV2 {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      !(value instanceof CompiledArtifactPromotionEvidenceV2) ||
      !ISSUED.has(value)
    ) {
      return false;
    }
    const evidence = value as CompiledArtifactPromotionEvidenceV2;
    if (
      evidence.schema !==
      'anvil.compiled-artifact-promotion-evidence.v2'
    ) {
      return false;
    }
    if (
      evidence.observationABIDigest !==
      SEMANTIC_OBSERVATION_ABI_DIGEST_V2
    ) {
      return false;
    }
    for (const [field, digest] of [
      ['artifactDigest', evidence.artifactDigest],
      ['buildDigest', evidence.buildDigest],
      ['providerProfileDigest', evidence.providerProfileDigest],
      ['calibrationIdentity', evidence.calibrationIdentity],
      ['observationABIDigest', evidence.observationABIDigest],
      ['safetyTrialDigest', evidence.safetyTrialDigest],
      ['evidenceDigest', evidence.evidenceDigest],
    ] as const) {
      requireDigest(digest, field);
    }

    return evidenceDigest({
      artifactDigest: evidence.artifactDigest,
      buildDigest: evidence.buildDigest,
      providerProfileDigest: evidence.providerProfileDigest,
      calibrationIdentity: evidence.calibrationIdentity,
      observationABIDigest: evidence.observationABIDigest,
      safetyTrialDigest: evidence.safetyTrialDigest,
      strongHoldoutSamples: evidence.strongHoldoutSamples,
      falseAuthorityLeaks: evidence.falseAuthorityLeaks,
      ece: evidence.ece,
      brier: evidence.brier,
      selectiveRisk: evidence.selectiveRisk,
      coverage: evidence.coverage,
    }) === evidence.evidenceDigest;
  } catch {
    return false;
  }
}
