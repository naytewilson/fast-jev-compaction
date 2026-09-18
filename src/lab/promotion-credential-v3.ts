import {
  deriveAuthorityIdentity,
  digestTaggedIdentity,
  type Digest256,
  type TaggedIdentityComponent,
} from './identity.js';
import {
  verifyPromotedCalibrationArtifactV3,
  type PromotedCalibrationArtifactV3,
} from './calibration-artifact-promotion-v2.js';
import {
  verifyProviderExecutionProfile,
  type ProviderExecutionProfile,
} from './provider-profile.js';
import {
  SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
} from './semantic-contract-v2.js';

export interface PromotionCredentialIssueInputV3 {
  providerProfile: ProviderExecutionProfile;
  promotedArtifact: PromotedCalibrationArtifactV3;
  policyProfileDigest: Digest256;
  observationABIDigest: Digest256;
  sourceLineageDigest: Digest256;
  authorityGeneration: number;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISSUE_TOKEN = Symbol('ANVIL.PromotedAuthorityCredential.v3');
const ISSUED = new WeakSet<object>();

function requireDigest(value: string, field: string): Uint8Array {
  if (!DIGEST.test(value)) {
    throw new TypeError(`${field} must be canonical sha256`);
  }
  return Buffer.from(value.slice('sha256:'.length), 'hex');
}

function generationBytes(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(
      'authorityGeneration must be a non-negative safe integer',
    );
  }
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value));
  return bytes;
}

interface CredentialFieldsV3 {
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

export class PromotedAuthorityCredentialV3 {
  public readonly schema =
    'anvil.promoted-authority-credential.v3' as const;

  private constructor(token: symbol, fields: CredentialFieldsV3) {
    if (token !== ISSUE_TOKEN) {
      throw new Error('semantic v2 credential constructor is issuer protected');
    }
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

  static issue(
    token: symbol,
    fields: CredentialFieldsV3,
  ): PromotedAuthorityCredentialV3 {
    if (token !== ISSUE_TOKEN) {
      throw new Error('semantic v2 credential issuer mismatch');
    }
    return new PromotedAuthorityCredentialV3(token, fields);
  }
}

function computeCredentialDigestV3(
  input: Omit<
    CredentialFieldsV3,
    'providerId' | 'credentialDigest'
  >,
): Digest256 {
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
  return digestTaggedIdentity(
    'ANVIL.PromotedAuthorityCredential.v3',
    components,
  );
}

export class PromotionAuthorityIssuerV3 {
  issue(
    input: PromotionCredentialIssueInputV3,
  ): Readonly<PromotedAuthorityCredentialV3> {
    if (!verifyProviderExecutionProfile(input.providerProfile)) {
      throw new TypeError(
        'semantic v2 provider profile is not internally verifiable',
      );
    }
    if (!verifyPromotedCalibrationArtifactV3(input.promotedArtifact)) {
      throw new Error(
        'semantic v2 issuer requires an issued promoted calibration artifact',
      );
    }
    requireDigest(input.policyProfileDigest, 'policyProfileDigest');
    requireDigest(input.observationABIDigest, 'observationABIDigest');
    requireDigest(input.sourceLineageDigest, 'sourceLineageDigest');
    generationBytes(input.authorityGeneration);

    if (
      input.providerProfile.observationABIDigest !==
      SEMANTIC_OBSERVATION_ABI_DIGEST_V2 ||
      input.observationABIDigest !==
      SEMANTIC_OBSERVATION_ABI_DIGEST_V2
    ) {
      throw new Error(
        'semantic v2 credential must bind the canonical Observation ABI',
      );
    }
    if (
      input.promotedArtifact.observationABIDigest !==
      input.observationABIDigest
    ) {
      throw new Error(
        'semantic v2 promoted artifact Observation ABI mismatch',
      );
    }
    if (
      input.promotedArtifact.providerProfileDigest !==
      input.providerProfile.providerProfileDigest
    ) {
      throw new Error(
        'semantic v2 promoted artifact provider profile mismatch',
      );
    }

    const authorityIdentity = deriveAuthorityIdentity({
      calibrationIdentity: input.promotedArtifact.calibrationIdentity,
      policyProfileDigest: input.policyProfileDigest,
      observationABIDigest: input.observationABIDigest,
    });

    const digestInput = {
      providerProfileDigest: input.providerProfile.providerProfileDigest,
      executionSemanticsDigest:
        input.providerProfile.executionSemanticsDigest,
      calibrationIdentity: input.promotedArtifact.calibrationIdentity,
      promotedArtifactDigest:
        input.promotedArtifact.promotedArtifactDigest,
      policyProfileDigest: input.policyProfileDigest,
      observationABIDigest: input.observationABIDigest,
      authorityIdentity,
      promotionPolicyDigest:
        input.promotedArtifact.promotionPolicyDigest,
      sourceLineageDigest: input.sourceLineageDigest,
      authorityGeneration: input.authorityGeneration,
    };
    const credentialDigest = computeCredentialDigestV3(digestInput);

    return PromotedAuthorityCredentialV3.issue(ISSUE_TOKEN, {
      providerId: input.providerProfile.providerId,
      ...digestInput,
      credentialDigest,
    });
  }
}

export function verifyPromotedAuthorityCredentialV3(
  value: unknown,
): value is PromotedAuthorityCredentialV3 {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      !(value instanceof PromotedAuthorityCredentialV3) ||
      !ISSUED.has(value)
    ) return false;

    const credential = value as PromotedAuthorityCredentialV3;
    if (
      credential.schema !==
      'anvil.promoted-authority-credential.v3'
    ) return false;
    if (
      credential.observationABIDigest !==
      SEMANTIC_OBSERVATION_ABI_DIGEST_V2
    ) return false;
    if (
      credential.providerId.length === 0 ||
      credential.providerId.includes('\0')
    ) return false;
    if (!DIGEST.test(credential.credentialDigest)) return false;

    return computeCredentialDigestV3({
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
