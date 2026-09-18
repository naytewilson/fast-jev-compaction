import {
  digestTaggedIdentity,
  type Digest256,
  type TaggedIdentityComponent,
} from './identity.js';
import {
  evaluateCalibrationPromotion,
  type CalibrationPromotionPolicy,
} from './calibration-promotion.js';
import {
  verifyProviderCalibrationArtifact,
  type ProviderCalibrationArtifact,
} from './calibration-artifact.js';
import {
  verifyCompiledArtifactPromotionEvidence,
  type CompiledArtifactPromotionEvidence,
} from './promotion-evidence.js';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISSUE_TOKEN = Symbol('ANVIL.PromotedCalibrationArtifact.v2');
const ISSUED = new WeakSet<object>();

function requireDigest(value: string, field: string): Uint8Array {
  if (!DIGEST.test(value)) throw new TypeError(`${field} must be canonical sha256`);
  return Buffer.from(value.slice('sha256:'.length), 'hex');
}

function promotedDigest(input: {
  artifactDigest: Digest256;
  providerProfileDigest: Digest256;
  calibrationIdentity: Digest256;
  promotionPolicyDigest: Digest256;
  promotionEvidenceDigest: Digest256;
}): Digest256 {
  const components: TaggedIdentityComponent[] = [
    { tag: 1, data: requireDigest(input.artifactDigest, 'artifactDigest') },
    { tag: 2, data: requireDigest(input.providerProfileDigest, 'providerProfileDigest') },
    { tag: 3, data: requireDigest(input.calibrationIdentity, 'calibrationIdentity') },
    { tag: 4, data: requireDigest(input.promotionPolicyDigest, 'promotionPolicyDigest') },
    { tag: 5, data: requireDigest(input.promotionEvidenceDigest, 'promotionEvidenceDigest') },
  ];
  return digestTaggedIdentity('ANVIL.PromotedCalibrationArtifact.v2', components);
}

export class PromotedCalibrationArtifact {
  public readonly schema = 'anvil.promoted-calibration-artifact.v2' as const;

  private constructor(
    token: symbol,
    public readonly artifactDigest: Digest256,
    public readonly providerProfileDigest: Digest256,
    public readonly calibrationIdentity: Digest256,
    public readonly promotionPolicyDigest: Digest256,
    public readonly promotionEvidenceDigest: Digest256,
    public readonly promotedArtifactDigest: Digest256,
  ) {
    if (token !== ISSUE_TOKEN) throw new Error('promoted artifact constructor is registry protected');
    ISSUED.add(this);
    Object.freeze(this);
  }

  static issue(token: symbol, fields: {
    artifactDigest: Digest256;
    providerProfileDigest: Digest256;
    calibrationIdentity: Digest256;
    promotionPolicyDigest: Digest256;
    promotionEvidenceDigest: Digest256;
    promotedArtifactDigest: Digest256;
  }): PromotedCalibrationArtifact {
    if (token !== ISSUE_TOKEN) throw new Error('promoted artifact issuer mismatch');
    return new PromotedCalibrationArtifact(
      token,
      fields.artifactDigest,
      fields.providerProfileDigest,
      fields.calibrationIdentity,
      fields.promotionPolicyDigest,
      fields.promotionEvidenceDigest,
      fields.promotedArtifactDigest,
    );
  }
}

export class CalibrationArtifactPromotionRegistry {
  private readonly promoted = new Map<string, PromotedCalibrationArtifact>();

  promote(
    artifact: ProviderCalibrationArtifact,
    evidence: CompiledArtifactPromotionEvidence,
    policy: CalibrationPromotionPolicy,
  ): Readonly<PromotedCalibrationArtifact> {
    if (!verifyProviderCalibrationArtifact(artifact)) {
      throw new Error('promotion requires an issued provider calibration artifact');
    }
    if (!verifyCompiledArtifactPromotionEvidence(evidence)) {
      throw new Error('promotion requires issued compiled promotion evidence');
    }
    if (evidence.artifactDigest !== artifact.artifactDigest) {
      throw new Error('compiled promotion evidence artifact mismatch');
    }
    if (evidence.providerProfileDigest !== artifact.providerProfileDigest) {
      throw new Error('compiled promotion evidence provider mismatch');
    }
    if (evidence.calibrationIdentity !== artifact.calibrationIdentity) {
      throw new Error('compiled promotion evidence calibration mismatch');
    }

    const decision = evaluateCalibrationPromotion({
      calibrationIdentity: artifact.calibrationIdentity,
      strongHoldoutSamples: evidence.strongHoldoutSamples,
      falseAuthorityLeaks: evidence.falseAuthorityLeaks,
      ece: evidence.ece,
      brier: evidence.brier,
      selectiveRisk: evidence.selectiveRisk,
      coverage: evidence.coverage,
    }, policy);
    if (decision.status !== 'CANARY_ELIGIBLE' || decision.reasons.length !== 0) {
      throw new Error(
        `calibration artifact promotion is not CANARY_ELIGIBLE: ${decision.reasons.join(',')}`,
      );
    }

    const digest = promotedDigest({
      artifactDigest: artifact.artifactDigest,
      providerProfileDigest: artifact.providerProfileDigest,
      calibrationIdentity: artifact.calibrationIdentity,
      promotionPolicyDigest: decision.policyDigest,
      promotionEvidenceDigest: evidence.evidenceDigest,
    });
    if (this.promoted.has(digest)) {
      throw new Error(`duplicate promoted calibration artifact ${digest}`);
    }
    const promoted = PromotedCalibrationArtifact.issue(ISSUE_TOKEN, {
      artifactDigest: artifact.artifactDigest,
      providerProfileDigest: artifact.providerProfileDigest,
      calibrationIdentity: artifact.calibrationIdentity,
      promotionPolicyDigest: decision.policyDigest,
      promotionEvidenceDigest: evidence.evidenceDigest,
      promotedArtifactDigest: digest,
    });
    this.promoted.set(digest, promoted);
    return promoted;
  }
}

export function verifyPromotedCalibrationArtifact(
  value: unknown,
): value is PromotedCalibrationArtifact {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      !(value instanceof PromotedCalibrationArtifact) ||
      !ISSUED.has(value)
    ) return false;
    const promoted = value as PromotedCalibrationArtifact;
    if (promoted.schema !== 'anvil.promoted-calibration-artifact.v2') return false;
    return promotedDigest({
      artifactDigest: promoted.artifactDigest,
      providerProfileDigest: promoted.providerProfileDigest,
      calibrationIdentity: promoted.calibrationIdentity,
      promotionPolicyDigest: promoted.promotionPolicyDigest,
      promotionEvidenceDigest: promoted.promotionEvidenceDigest,
    }) === promoted.promotedArtifactDigest;
  } catch {
    return false;
  }
}
