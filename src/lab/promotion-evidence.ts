import type { Digest256 } from './identity.js';
import {
  verifyProviderCalibrationBuildArtifact,
  type ProviderCalibrationBuildArtifact,
} from './calibration-evidence-compiler.js';
import {
  verifyProviderSafetyTrialArtifact,
  type ProviderSafetyTrialArtifact,
} from './provider-safety-trial.js';
import { sha256Digest } from './recovery.js';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISSUE_TOKEN = Symbol('ANVIL.CompiledArtifactPromotionEvidence.v1');
const ISSUED = new WeakSet<object>();

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) throw new TypeError(`${field} must be canonical sha256`);
}

function evidenceDigest(input: {
  artifactDigest: Digest256;
  buildDigest: Digest256;
  providerProfileDigest: Digest256;
  calibrationIdentity: Digest256;
  safetyTrialDigest: Digest256;
  strongHoldoutSamples: number;
  falseAuthorityLeaks: number;
  ece: number;
  brier: number;
  selectiveRisk: number;
  coverage: number;
}): Digest256 {
  return sha256Digest(JSON.stringify({
    schema: 'anvil.compiled-artifact-promotion-evidence.v1',
    ...input,
  }));
}

export class CompiledArtifactPromotionEvidence {
  public readonly schema = 'anvil.compiled-artifact-promotion-evidence.v1' as const;

  private constructor(
    token: symbol,
    public readonly artifactDigest: Digest256,
    public readonly buildDigest: Digest256,
    public readonly providerProfileDigest: Digest256,
    public readonly calibrationIdentity: Digest256,
    public readonly safetyTrialDigest: Digest256,
    public readonly strongHoldoutSamples: number,
    public readonly falseAuthorityLeaks: number,
    public readonly ece: number,
    public readonly brier: number,
    public readonly selectiveRisk: number,
    public readonly coverage: number,
    public readonly evidenceDigest: Digest256,
  ) {
    if (token !== ISSUE_TOKEN) throw new Error('promotion evidence constructor is compiler protected');
    ISSUED.add(this);
    Object.freeze(this);
  }

  static issue(token: symbol, fields: {
    artifactDigest: Digest256;
    buildDigest: Digest256;
    providerProfileDigest: Digest256;
    calibrationIdentity: Digest256;
    safetyTrialDigest: Digest256;
    strongHoldoutSamples: number;
    falseAuthorityLeaks: number;
    ece: number;
    brier: number;
    selectiveRisk: number;
    coverage: number;
    evidenceDigest: Digest256;
  }): CompiledArtifactPromotionEvidence {
    if (token !== ISSUE_TOKEN) throw new Error('promotion evidence issuer mismatch');
    return new CompiledArtifactPromotionEvidence(
      token,
      fields.artifactDigest,
      fields.buildDigest,
      fields.providerProfileDigest,
      fields.calibrationIdentity,
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

export class ArtifactPromotionEvidenceCompiler {
  compile(
    build: ProviderCalibrationBuildArtifact,
    safety: ProviderSafetyTrialArtifact,
  ): Readonly<CompiledArtifactPromotionEvidence> {
    if (!verifyProviderCalibrationBuildArtifact(build)) {
      throw new Error('promotion evidence requires an issued calibration build artifact');
    }
    if (!verifyProviderSafetyTrialArtifact(safety)) {
      throw new Error('promotion evidence requires an issued provider safety trial artifact');
    }
    if (safety.evidenceAuthority !== 'MEASURED_SHADOW') {
      throw new Error('promotion evidence requires MEASURED_SHADOW authoritative safety evidence');
    }
    if (build.providerProfileDigest !== safety.providerProfileDigest) {
      throw new Error('provider profile mismatch between calibration and safety evidence');
    }
    if (
      build.calibrationArtifact.calibrationIdentity !==
      safety.calibrationIdentity
    ) {
      throw new Error('calibration identity mismatch between build and safety evidence');
    }
    if (
      build.calibrationArtifact.providerProfile.observationABIDigest !==
      safety.observationABIDigest
    ) {
      throw new Error('Observation ABI mismatch between build and safety evidence');
    }
    if (safety.result.falseAuthority.opportunities <= 0) {
      throw new Error('safety evidence has no false-authority opportunities');
    }

    const metrics = build.holdoutMetrics;
    const core = {
      artifactDigest: build.calibrationArtifact.artifactDigest,
      buildDigest: build.buildDigest,
      providerProfileDigest: build.providerProfileDigest,
      calibrationIdentity: build.calibrationArtifact.calibrationIdentity,
      safetyTrialDigest: safety.trialDigest,
      strongHoldoutSamples: metrics.sampleCount,
      falseAuthorityLeaks: safety.result.falseAuthority.leaks,
      ece: metrics.ece,
      brier: metrics.brier,
      selectiveRisk: metrics.selectiveRisk,
      coverage: metrics.coverage,
    };
    const digest = evidenceDigest(core);
    return CompiledArtifactPromotionEvidence.issue(ISSUE_TOKEN, {
      ...core,
      evidenceDigest: digest,
    });
  }
}

export function verifyCompiledArtifactPromotionEvidence(
  value: unknown,
): value is CompiledArtifactPromotionEvidence {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      !(value instanceof CompiledArtifactPromotionEvidence) ||
      !ISSUED.has(value)
    ) return false;
    const evidence = value as CompiledArtifactPromotionEvidence;
    if (evidence.schema !== 'anvil.compiled-artifact-promotion-evidence.v1') return false;
    for (const [field, digest] of [
      ['artifactDigest', evidence.artifactDigest],
      ['buildDigest', evidence.buildDigest],
      ['providerProfileDigest', evidence.providerProfileDigest],
      ['calibrationIdentity', evidence.calibrationIdentity],
      ['safetyTrialDigest', evidence.safetyTrialDigest],
      ['evidenceDigest', evidence.evidenceDigest],
    ] as const) requireDigest(digest, field);

    return evidenceDigest({
      artifactDigest: evidence.artifactDigest,
      buildDigest: evidence.buildDigest,
      providerProfileDigest: evidence.providerProfileDigest,
      calibrationIdentity: evidence.calibrationIdentity,
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
