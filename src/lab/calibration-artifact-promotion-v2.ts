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
  verifyProviderCalibrationArtifactV2,
  type ProviderCalibrationArtifactV2,
} from './provider-calibration-artifact-v2.js';
import {
  verifyCompiledArtifactPromotionEvidenceV2,
  type CompiledArtifactPromotionEvidenceV2,
} from './promotion-evidence-v2.js';
import {
  SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
} from './semantic-contract-v2.js';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISSUE_TOKEN = Symbol('ANVIL.PromotedCalibrationArtifact.v3');
const ISSUED = new WeakSet<object>();

function requireDigest(value: string, field: string): Uint8Array {
  if (!DIGEST.test(value)) {
    throw new TypeError(`${field} must be canonical sha256`);
  }
  return Buffer.from(value.slice('sha256:'.length), 'hex');
}

function promotedDigest(input: {
  artifactDigest: Digest256;
  providerProfileDigest: Digest256;
  calibrationIdentity: Digest256;
  observationABIDigest: Digest256;
  promotionPolicyDigest: Digest256;
  promotionEvidenceDigest: Digest256;
}): Digest256 {
  const components: TaggedIdentityComponent[] = [
    { tag: 1, data: requireDigest(input.artifactDigest, 'artifactDigest') },
    { tag: 2, data: requireDigest(input.providerProfileDigest, 'providerProfileDigest') },
    { tag: 3, data: requireDigest(input.calibrationIdentity, 'calibrationIdentity') },
    { tag: 4, data: requireDigest(input.observationABIDigest, 'observationABIDigest') },
    { tag: 5, data: requireDigest(input.promotionPolicyDigest, 'promotionPolicyDigest') },
    { tag: 6, data: requireDigest(input.promotionEvidenceDigest, 'promotionEvidenceDigest') },
  ];
  return digestTaggedIdentity(
    'ANVIL.PromotedCalibrationArtifact.v3',
    components,
  );
}

export class PromotedCalibrationArtifactV3 {
  public readonly schema =
    'anvil.promoted-calibration-artifact.v3' as const;

  private constructor(
    token: symbol,
    public readonly artifactDigest: Digest256,
    public readonly providerProfileDigest: Digest256,
    public readonly calibrationIdentity: Digest256,
    public readonly observationABIDigest: Digest256,
    public readonly promotionPolicyDigest: Digest256,
    public readonly promotionEvidenceDigest: Digest256,
    public readonly promotedArtifactDigest: Digest256,
  ) {
    if (token !== ISSUE_TOKEN) {
      throw new Error(
        'semantic v2 promoted artifact constructor is registry protected',
      );
    }
    ISSUED.add(this);
    Object.freeze(this);
  }

  static issue(token: symbol, fields: {
    artifactDigest: Digest256;
    providerProfileDigest: Digest256;
    calibrationIdentity: Digest256;
    observationABIDigest: Digest256;
    promotionPolicyDigest: Digest256;
    promotionEvidenceDigest: Digest256;
    promotedArtifactDigest: Digest256;
  }): PromotedCalibrationArtifactV3 {
    if (token !== ISSUE_TOKEN) {
      throw new Error('semantic v2 promoted artifact issuer mismatch');
    }
    return new PromotedCalibrationArtifactV3(
      token,
      fields.artifactDigest,
      fields.providerProfileDigest,
      fields.calibrationIdentity,
      fields.observationABIDigest,
      fields.promotionPolicyDigest,
      fields.promotionEvidenceDigest,
      fields.promotedArtifactDigest,
    );
  }
}

export class CalibrationArtifactPromotionRegistryV2 {
  private readonly promoted =
    new Map<string, PromotedCalibrationArtifactV3>();

  promote(
    artifact: ProviderCalibrationArtifactV2,
    evidence: CompiledArtifactPromotionEvidenceV2,
    policy: CalibrationPromotionPolicy,
  ): Readonly<PromotedCalibrationArtifactV3> {
    if (!verifyProviderCalibrationArtifactV2(artifact)) {
      throw new Error(
        'semantic v2 promotion requires an issued provider calibration artifact',
      );
    }
    if (!verifyCompiledArtifactPromotionEvidenceV2(evidence)) {
      throw new Error(
        'semantic v2 promotion requires issued compiled promotion evidence',
      );
    }
    if (artifact.providerProfile.observationABIDigest !==
      SEMANTIC_OBSERVATION_ABI_DIGEST_V2) {
      throw new Error('semantic v2 calibration artifact ABI mismatch');
    }
    if (evidence.artifactDigest !== artifact.artifactDigest) {
      throw new Error('semantic v2 compiled promotion evidence artifact mismatch');
    }
    if (evidence.providerProfileDigest !== artifact.providerProfileDigest) {
      throw new Error('semantic v2 compiled promotion evidence provider mismatch');
    }
    if (evidence.calibrationIdentity !== artifact.calibrationIdentity) {
      throw new Error('semantic v2 compiled promotion evidence calibration mismatch');
    }
    if (
      evidence.observationABIDigest !==
      SEMANTIC_OBSERVATION_ABI_DIGEST_V2
    ) {
      throw new Error(
        'semantic v2 compiled promotion evidence Observation ABI mismatch',
      );
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
    if (
      decision.status !== 'CANARY_ELIGIBLE' ||
      decision.reasons.length !== 0
    ) {
      throw new Error(
        `semantic v2 calibration artifact promotion is not CANARY_ELIGIBLE: ${decision.reasons.join(',')}`,
      );
    }

    const digest = promotedDigest({
      artifactDigest: artifact.artifactDigest,
      providerProfileDigest: artifact.providerProfileDigest,
      calibrationIdentity: artifact.calibrationIdentity,
      observationABIDigest: SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
      promotionPolicyDigest: decision.policyDigest,
      promotionEvidenceDigest: evidence.evidenceDigest,
    });
    if (this.promoted.has(digest)) {
      throw new Error(
        `duplicate semantic v2 promoted calibration artifact ${digest}`,
      );
    }

    const promoted = PromotedCalibrationArtifactV3.issue(
      ISSUE_TOKEN,
      {
        artifactDigest: artifact.artifactDigest,
        providerProfileDigest: artifact.providerProfileDigest,
        calibrationIdentity: artifact.calibrationIdentity,
        observationABIDigest: SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
        promotionPolicyDigest: decision.policyDigest,
        promotionEvidenceDigest: evidence.evidenceDigest,
        promotedArtifactDigest: digest,
      },
    );
    this.promoted.set(digest, promoted);
    return promoted;
  }
}

export function verifyPromotedCalibrationArtifactV3(
  value: unknown,
): value is PromotedCalibrationArtifactV3 {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      !(value instanceof PromotedCalibrationArtifactV3) ||
      !ISSUED.has(value)
    ) return false;
    const promoted = value as PromotedCalibrationArtifactV3;
    if (
      promoted.schema !==
      'anvil.promoted-calibration-artifact.v3'
    ) return false;
    if (
      promoted.observationABIDigest !==
      SEMANTIC_OBSERVATION_ABI_DIGEST_V2
    ) return false;

    return promotedDigest({
      artifactDigest: promoted.artifactDigest,
      providerProfileDigest: promoted.providerProfileDigest,
      calibrationIdentity: promoted.calibrationIdentity,
      observationABIDigest: promoted.observationABIDigest,
      promotionPolicyDigest: promoted.promotionPolicyDigest,
      promotionEvidenceDigest: promoted.promotionEvidenceDigest,
    }) === promoted.promotedArtifactDigest;
  } catch {
    return false;
  }
}
