import {
  sha256Digest,
  type InMemoryCAS,
  type RecoveryManifest,
  type RecoveryVerification,
} from './recovery.js';

export const MECHANICAL_RECOVERY_ATTESTATION_SCHEMA =
  'anvil.mechanical-recovery-attestation.v1' as const;

export type MechanicalRecoveryStatus =
  | 'VERIFIED'
  | 'MISSING_OBJECT'
  | 'DIGEST_MISMATCH'
  | 'BYTE_COUNT_MISMATCH'
  | 'CANDIDATE_MISMATCH';

export type MechanicalRecoveryVerificationCode =
  | 'missing_object'
  | 'digest_mismatch'
  | 'byte_count_mismatch'
  | 'candidate_mismatch';

export interface MechanicalRecoveryAttestInput {
  candidateId: string;
  manifest: RecoveryManifest;
  stdout: string;
  stderr: string;
  exitStatus: number;
}

export interface MechanicalRecoveryExpectedIdentity {
  candidateId: string;
  sourceDigest: string;
}

export type MechanicalRecoveryAttestationVerification =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'unissued_recovery_attestation'
        | 'recovery_identity_mismatch'
        | 'invalid_recovery_attestation'
        | 'stale_recovery_snapshot';
      detail: string;
    };

const ISSUE_TOKEN = Symbol('ANVIL.MechanicalRecoveryAttestation.v1');
const ISSUED = new WeakSet<object>();
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const CAS_REF = /^cas:[A-Za-z0-9._:-]+$/;

function statusFor(
  verification: RecoveryVerification,
): {
  status: MechanicalRecoveryStatus;
  verificationCode: MechanicalRecoveryVerificationCode | null;
} {
  if (verification.ok) {
    return { status: 'VERIFIED', verificationCode: null };
  }
  switch (verification.code) {
    case 'missing_object':
      return {
        status: 'MISSING_OBJECT',
        verificationCode: verification.code,
      };
    case 'digest_mismatch':
      return {
        status: 'DIGEST_MISMATCH',
        verificationCode: verification.code,
      };
    case 'byte_count_mismatch':
      return {
        status: 'BYTE_COUNT_MISMATCH',
        verificationCode: verification.code,
      };
    case 'candidate_mismatch':
      return {
        status: 'CANDIDATE_MISMATCH',
        verificationCode: verification.code,
      };
  }
}

function digestCore(input: {
  candidateId: string;
  sourceDigest: string;
  recoveryRef: string;
  byteCount: number;
  storeSnapshotDigest: string;
  status: MechanicalRecoveryStatus;
  verificationCode: MechanicalRecoveryVerificationCode | null;
}): string {
  return sha256Digest(JSON.stringify({
    schema: MECHANICAL_RECOVERY_ATTESTATION_SCHEMA,
    ...input,
  }));
}

export class MechanicalRecoveryAttestation {
  public readonly schema =
    MECHANICAL_RECOVERY_ATTESTATION_SCHEMA;

  private constructor(
    token: symbol,
    public readonly candidateId: string,
    public readonly sourceDigest: string,
    public readonly recoveryRef: string,
    public readonly byteCount: number,
    public readonly storeSnapshotDigest: string,
    public readonly status: MechanicalRecoveryStatus,
    public readonly verificationCode:
      MechanicalRecoveryVerificationCode | null,
    public readonly attestationDigest: string,
  ) {
    if (token !== ISSUE_TOKEN) {
      throw new Error(
        'mechanical recovery attestation constructor is attestor protected',
      );
    }
    ISSUED.add(this);
    Object.freeze(this);
  }

  static issue(
    token: symbol,
    fields: {
      candidateId: string;
      sourceDigest: string;
      recoveryRef: string;
      byteCount: number;
      storeSnapshotDigest: string;
      status: MechanicalRecoveryStatus;
      verificationCode: MechanicalRecoveryVerificationCode | null;
      attestationDigest: string;
    },
  ): MechanicalRecoveryAttestation {
    if (token !== ISSUE_TOKEN) {
      throw new Error('mechanical recovery attestation issuer mismatch');
    }
    return new MechanicalRecoveryAttestation(
      token,
      fields.candidateId,
      fields.sourceDigest,
      fields.recoveryRef,
      fields.byteCount,
      fields.storeSnapshotDigest,
      fields.status,
      fields.verificationCode,
      fields.attestationDigest,
    );
  }
}

export class MechanicalRecoveryAttestor {
  attestTool(
    input: MechanicalRecoveryAttestInput,
    cas: InMemoryCAS,
  ): Readonly<MechanicalRecoveryAttestation> {
    if (
      input.candidateId.length === 0 ||
      input.candidateId.includes('\0')
    ) {
      throw new TypeError(
        'candidateId must be non-empty and NUL-free',
      );
    }
    if (!DIGEST.test(input.manifest.source_digest)) {
      throw new TypeError(
        'manifest source_digest must be canonical sha256',
      );
    }
    if (!CAS_REF.test(input.manifest.recovery_ref)) {
      throw new TypeError(
        'manifest recovery_ref must be CAS-bound',
      );
    }
    if (
      !Number.isSafeInteger(input.manifest.byte_count) ||
      input.manifest.byte_count < 0
    ) {
      throw new TypeError(
        'manifest byte_count must be non-negative',
      );
    }

    const verification = cas.verifyTool(
      input.manifest,
      input.stdout,
      input.stderr,
      input.exitStatus,
    );
    const mapped = statusFor(verification);
    const storeSnapshotDigest = cas.snapshotDigest();
    const core = {
      candidateId: input.candidateId,
      sourceDigest: input.manifest.source_digest,
      recoveryRef: input.manifest.recovery_ref,
      byteCount: input.manifest.byte_count,
      storeSnapshotDigest,
      status: mapped.status,
      verificationCode: mapped.verificationCode,
    };

    return MechanicalRecoveryAttestation.issue(
      ISSUE_TOKEN,
      {
        ...core,
        attestationDigest: digestCore(core),
      },
    );
  }
}

export function verifyMechanicalRecoveryAttestation(
  expected: MechanicalRecoveryExpectedIdentity,
  value: unknown,
  currentStoreSnapshotDigest: string,
): MechanicalRecoveryAttestationVerification {
  if (
    typeof value !== 'object' ||
    value === null ||
    !(value instanceof MechanicalRecoveryAttestation) ||
    !ISSUED.has(value)
  ) {
    return {
      ok: false,
      code: 'unissued_recovery_attestation',
      detail: 'mechanical recovery authority must be attestor-issued',
    };
  }

  const attestation = value as MechanicalRecoveryAttestation;
  if (
    attestation.schema !==
      MECHANICAL_RECOVERY_ATTESTATION_SCHEMA ||
    !DIGEST.test(attestation.sourceDigest) ||
    !CAS_REF.test(attestation.recoveryRef) ||
    !DIGEST.test(attestation.storeSnapshotDigest) ||
    !DIGEST.test(attestation.attestationDigest) ||
    !Number.isSafeInteger(attestation.byteCount) ||
    attestation.byteCount < 0
  ) {
    return {
      ok: false,
      code: 'invalid_recovery_attestation',
      detail: 'mechanical recovery attestation fields are invalid',
    };
  }

  if (
    attestation.candidateId !== expected.candidateId ||
    attestation.sourceDigest !== expected.sourceDigest
  ) {
    return {
      ok: false,
      code: 'recovery_identity_mismatch',
      detail:
        'mechanical recovery attestation binds another candidate/source',
    };
  }

  if (!DIGEST.test(currentStoreSnapshotDigest)) {
    return {
      ok: false,
      code: 'invalid_recovery_attestation',
      detail: 'current CAS snapshot digest is malformed',
    };
  }

  if (
    attestation.storeSnapshotDigest !==
    currentStoreSnapshotDigest
  ) {
    return {
      ok: false,
      code: 'stale_recovery_snapshot',
      detail:
        'mechanical recovery attestation was issued against another CAS snapshot',
    };
  }

  const expectedDigest = digestCore({
    candidateId: attestation.candidateId,
    sourceDigest: attestation.sourceDigest,
    recoveryRef: attestation.recoveryRef,
    byteCount: attestation.byteCount,
    storeSnapshotDigest: attestation.storeSnapshotDigest,
    status: attestation.status,
    verificationCode: attestation.verificationCode,
  });
  if (expectedDigest !== attestation.attestationDigest) {
    return {
      ok: false,
      code: 'invalid_recovery_attestation',
      detail: 'mechanical recovery attestation digest mismatch',
    };
  }

  return { ok: true };
}
