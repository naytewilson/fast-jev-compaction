import {
  deriveAuthorityIdentity,
  digestTaggedIdentity,
  type Digest256,
  type TaggedIdentityComponent,
} from './identity.js';
import {
  verifyPromotedCalibrationArtifact,
  type PromotedCalibrationArtifact,
} from './calibration-artifact-promotion.js';
import {
  verifyProviderExecutionProfile,
  type ProviderExecutionProfile,
} from './provider-profile.js';

export interface PromotionCredentialIssueInput {
  providerProfile: ProviderExecutionProfile;
  promotedArtifact: PromotedCalibrationArtifact;
  policyProfileDigest: Digest256;
  observationABIDigest: Digest256;
  sourceLineageDigest: Digest256;
  authorityGeneration: number;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISSUE_TOKEN = Symbol('ANVIL.PromotedAuthorityCredential.v2');
const ISSUED = new WeakSet<object>();

function requireDigest(value: string, field: string): Uint8Array {
  if (!DIGEST.test(value)) throw new TypeError(`${field} must be canonical sha256`);
  return Buffer.from(value.slice('sha256:'.length), 'hex');
}

function generationBytes(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('authorityGeneration must be a non-negative safe integer');
  }
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value));
  return bytes;
}

interface CredentialFields {
  providerId: string;
  providerProfileDigest: Digest256;
  executionSemanticsDigest: Digest256;
  calibrationIdentity: Digest256;
  promotedArtifactDigest: Digest256;
  policyProfileDigest: Digest256;
  observationABIDigest: Digest256;
  authorityIdentity: Digest256;
  promotionPolicyDigest: Digest256;
  sourceLineageDigest: Digest256;
  authorityGeneration: number;
  credentialDigest: Digest256;
}

export class PromotedAuthorityCredential {
  public readonly schema = 'anvil.promoted-authority-credential.v2' as const;

  private constructor(token: symbol, fields: CredentialFields) {
    if (token !== ISSUE_TOKEN) throw new Error('credential constructor is issuer protected');
    Object.assign(this, fields);
    ISSUED.add(this);
    Object.freeze(this);
  }

  public readonly providerId!: string;
  public readonly providerProfileDigest!: Digest256;
  public readonly executionSemanticsDigest!: Digest256;
  public readonly calibrationIdentity!: Digest256;
  public readonly promotedArtifactDigest!: Digest256;
  public readonly policyProfileDigest!: Digest256;
  public readonly observationABIDigest!: Digest256;
  public readonly authorityIdentity!: Digest256;
  public readonly promotionPolicyDigest!: Digest256;
  public readonly sourceLineageDigest!: Digest256;
  public readonly authorityGeneration!: number;
  public readonly credentialDigest!: Digest256;

  static issue(token: symbol, fields: CredentialFields): PromotedAuthorityCredential {
    if (token !== ISSUE_TOKEN) throw new Error('credential issuer mismatch');
    return new PromotedAuthorityCredential(token, fields);
  }
}

function computeCredentialDigest(input: Omit<CredentialFields, 'providerId' | 'credentialDigest'>): Digest256 {
  const components: TaggedIdentityComponent[] = [
    { tag: 1, data: requireDigest(input.providerProfileDigest, 'providerProfileDigest') },
    { tag: 2, data: requireDigest(input.executionSemanticsDigest, 'executionSemanticsDigest') },
    { tag: 3, data: requireDigest(input.calibrationIdentity, 'calibrationIdentity') },
    { tag: 4, data: requireDigest(input.promotedArtifactDigest, 'promotedArtifactDigest') },
    { tag: 5, data: requireDigest(input.policyProfileDigest, 'policyProfileDigest') },
    { tag: 6, data: requireDigest(input.observationABIDigest, 'observationABIDigest') },
    { tag: 7, data: requireDigest(input.authorityIdentity, 'authorityIdentity') },
    { tag: 8, data: requireDigest(input.promotionPolicyDigest, 'promotionPolicyDigest') },
    { tag: 9, data: requireDigest(input.sourceLineageDigest, 'sourceLineageDigest') },
    { tag: 10, data: generationBytes(input.authorityGeneration) },
  ];
  return digestTaggedIdentity('ANVIL.PromotedAuthorityCredential.v2', components);
}

export class PromotionAuthorityIssuer {
  issue(input: PromotionCredentialIssueInput): Readonly<PromotedAuthorityCredential> {
    if (!verifyProviderExecutionProfile(input.providerProfile)) {
      throw new TypeError('provider profile is not internally verifiable');
    }
    if (!verifyPromotedCalibrationArtifact(input.promotedArtifact)) {
      throw new Error('issuer requires an issued promoted calibration artifact');
    }
    requireDigest(input.policyProfileDigest, 'policyProfileDigest');
    requireDigest(input.observationABIDigest, 'observationABIDigest');
    requireDigest(input.sourceLineageDigest, 'sourceLineageDigest');
    generationBytes(input.authorityGeneration);

    if (
      input.promotedArtifact.providerProfileDigest !==
      input.providerProfile.providerProfileDigest
    ) {
      throw new Error('promoted artifact provider profile mismatch');
    }
    if (input.providerProfile.observationABIDigest !== input.observationABIDigest) {
      throw new Error('provider profile Observation ABI does not match credential ABI');
    }

    const authorityIdentity = deriveAuthorityIdentity({
      calibrationIdentity: input.promotedArtifact.calibrationIdentity,
      policyProfileDigest: input.policyProfileDigest,
      observationABIDigest: input.observationABIDigest,
    });
    const digestInput = {
      providerProfileDigest: input.providerProfile.providerProfileDigest,
      executionSemanticsDigest: input.providerProfile.executionSemanticsDigest,
      calibrationIdentity: input.promotedArtifact.calibrationIdentity,
      promotedArtifactDigest: input.promotedArtifact.promotedArtifactDigest,
      policyProfileDigest: input.policyProfileDigest,
      observationABIDigest: input.observationABIDigest,
      authorityIdentity,
      promotionPolicyDigest: input.promotedArtifact.promotionPolicyDigest,
      sourceLineageDigest: input.sourceLineageDigest,
      authorityGeneration: input.authorityGeneration,
    };
    const credentialDigest = computeCredentialDigest(digestInput);

    return PromotedAuthorityCredential.issue(ISSUE_TOKEN, {
      providerId: input.providerProfile.providerId,
      ...digestInput,
      credentialDigest,
    });
  }
}

export function verifyPromotedAuthorityCredential(
  value: unknown,
): value is PromotedAuthorityCredential {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      !(value instanceof PromotedAuthorityCredential) ||
      !ISSUED.has(value)
    ) return false;
    const credential = value as PromotedAuthorityCredential;
    if (credential.schema !== 'anvil.promoted-authority-credential.v2') return false;
    if (credential.providerId.length === 0 || credential.providerId.includes('\0')) return false;
    if (!DIGEST.test(credential.credentialDigest)) return false;

    return computeCredentialDigest({
      providerProfileDigest: credential.providerProfileDigest,
      executionSemanticsDigest: credential.executionSemanticsDigest,
      calibrationIdentity: credential.calibrationIdentity,
      promotedArtifactDigest: credential.promotedArtifactDigest,
      policyProfileDigest: credential.policyProfileDigest,
      observationABIDigest: credential.observationABIDigest,
      authorityIdentity: credential.authorityIdentity,
      promotionPolicyDigest: credential.promotionPolicyDigest,
      sourceLineageDigest: credential.sourceLineageDigest,
      authorityGeneration: credential.authorityGeneration,
    }) === credential.credentialDigest;
  } catch {
    return false;
  }
}
