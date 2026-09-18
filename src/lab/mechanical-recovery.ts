import type { ReplayCandidate } from './replay.js';
import {
  encodeToolEvidence,
  sha256Digest,
  type InMemoryCAS,
  type RecoveryVerification,
} from './recovery.js';

export type MechanicalRecoveryStatus = 'VERIFIED' | 'UNAVAILABLE';

export type MechanicalRecoverySourceFailureCode =
  | 'missing_object'
  | 'digest_mismatch'
  | 'byte_count_mismatch'
  | 'candidate_mismatch';

export type MechanicalRecoveryAuthorityFailureCode =
  | MechanicalRecoverySourceFailureCode
  | 'unissued_recovery_evidence'
  | 'recovery_identity_mismatch'
  | 'invalid_recovery_evidence'
  | 'stale_recovery_snapshot';

export type MechanicalRecoveryAuthorityVerification =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'unissued_recovery_evidence'
        | 'recovery_identity_mismatch'
        | 'invalid_recovery_evidence'
        | 'stale_recovery_snapshot';
      detail: string;
    };

const ISSUE_TOKEN = Symbol('ANVIL.MechanicalRecoveryEvidence.v1');
const ISSUED = new WeakSet<object>();
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function evidenceDigest(input: {
  candidate_id: string;
  source_digest: string;
  recovery_ref: string;
  byte_count: number;
  cas_snapshot_digest: string;
  status: MechanicalRecoveryStatus;
  failure_code: MechanicalRecoverySourceFailureCode | null;
}): string {
  return sha256Digest(JSON.stringify({
    schema: 'anvil.mechanical-recovery-evidence.v1',
    ...input,
  }));
}

export class MechanicalRecoveryEvidence {
  public readonly schema = 'anvil.mechanical-recovery-evidence.v1' as const;
  readonly #authorityBrand: true = true;

  private constructor(
    token: symbol,
    public readonly candidate_id: string,
    public readonly source_digest: string,
    public readonly recovery_ref: string,
    public readonly byte_count: number,
    public readonly cas_snapshot_digest: string,
    public readonly status: MechanicalRecoveryStatus,
    public readonly failure_code: MechanicalRecoverySourceFailureCode | null,
    public readonly evidence_digest: string,
  ) {
    if (token !== ISSUE_TOKEN) {
      throw new Error(
        'mechanical recovery evidence constructor is evaluator protected',
      );
    }
    ISSUED.add(this);
    Object.freeze(this);
  }

  static issue(
    token: symbol,
    fields: {
      candidate_id: string;
      source_digest: string;
      recovery_ref: string;
      byte_count: number;
      cas_snapshot_digest: string;
      status: MechanicalRecoveryStatus;
      failure_code: MechanicalRecoverySourceFailureCode | null;
      evidence_digest: string;
    },
  ): MechanicalRecoveryEvidence {
    if (token !== ISSUE_TOKEN) {
      throw new Error('mechanical recovery evidence issuer mismatch');
    }
    return new MechanicalRecoveryEvidence(
      token,
      fields.candidate_id,
      fields.source_digest,
      fields.recovery_ref,
      fields.byte_count,
      fields.cas_snapshot_digest,
      fields.status,
      fields.failure_code,
      fields.evidence_digest,
    );
  }
}

function outcome(
  verification: RecoveryVerification,
): {
  status: MechanicalRecoveryStatus;
  failure_code: MechanicalRecoverySourceFailureCode | null;
} {
  if (verification.ok) {
    return { status: 'VERIFIED', failure_code: null };
  }
  return {
    status: 'UNAVAILABLE',
    failure_code: verification.code,
  };
}

function candidateIdentityValid(candidate: ReplayCandidate): boolean {
  try {
    const canonical = encodeToolEvidence(
      candidate.stdout,
      candidate.stderr,
      candidate.exit_status,
    );
    return (
      candidate.recovery.source_digest === sha256Digest(canonical) &&
      candidate.recovery.byte_count === Buffer.byteLength(canonical, 'utf8') &&
      candidate.recovery.recovery_ref.startsWith('cas:')
    );
  } catch {
    return false;
  }
}

export function evaluateMechanicalRecovery(
  cas: InMemoryCAS,
  candidate: ReplayCandidate,
): MechanicalRecoveryEvidence {
  const verification = cas.verifyTool(
    candidate.recovery,
    candidate.stdout,
    candidate.stderr,
    candidate.exit_status,
  );
  const result = outcome(verification);
  const core = {
    candidate_id: candidate.candidate_id,
    source_digest: candidate.recovery.source_digest,
    recovery_ref: candidate.recovery.recovery_ref,
    byte_count: candidate.recovery.byte_count,
    cas_snapshot_digest: cas.snapshotDigest(),
    status: result.status,
    failure_code: result.failure_code,
  };
  return MechanicalRecoveryEvidence.issue(ISSUE_TOKEN, {
    ...core,
    evidence_digest: evidenceDigest(core),
  });
}

export function verifyMechanicalRecoveryEvidence(
  candidate: ReplayCandidate,
  value: unknown,
  currentStoreSnapshotDigest: string,
): MechanicalRecoveryAuthorityVerification {
  if (
    typeof value === 'object' &&
    value !== null &&
    'candidate_id' in value &&
    'source_digest' in value &&
    'recovery_ref' in value
  ) {
    const shaped = value as {
      candidate_id?: unknown;
      source_digest?: unknown;
      recovery_ref?: unknown;
    };
    if (
      shaped.candidate_id !== candidate.candidate_id ||
      shaped.source_digest !== candidate.recovery.source_digest ||
      shaped.recovery_ref !== candidate.recovery.recovery_ref
    ) {
      return {
        ok: false,
        code: 'recovery_identity_mismatch',
        detail: 'mechanical recovery evidence binds another candidate/source',
      };
    }
  }

  if (
    !(value instanceof MechanicalRecoveryEvidence) ||
    !ISSUED.has(value)
  ) {
    return {
      ok: false,
      code: 'unissued_recovery_evidence',
      detail: 'mechanical recovery authority must be evaluator-issued',
    };
  }

  const evidence = value as MechanicalRecoveryEvidence;
  if (
    evidence.schema !== 'anvil.mechanical-recovery-evidence.v1' ||
    !DIGEST.test(evidence.source_digest) ||
    !DIGEST.test(evidence.cas_snapshot_digest) ||
    !DIGEST.test(evidence.evidence_digest) ||
    !evidence.recovery_ref.startsWith('cas:') ||
    !Number.isSafeInteger(evidence.byte_count) ||
    evidence.byte_count < 0 ||
    !candidateIdentityValid(candidate) ||
    evidence.byte_count !== candidate.recovery.byte_count
  ) {
    return {
      ok: false,
      code: 'invalid_recovery_evidence',
      detail: 'mechanical recovery evidence fields or candidate identity are invalid',
    };
  }

  if (
    (evidence.status === 'VERIFIED' && evidence.failure_code !== null) ||
    (evidence.status === 'UNAVAILABLE' && evidence.failure_code === null)
  ) {
    return {
      ok: false,
      code: 'invalid_recovery_evidence',
      detail: 'mechanical recovery status/failure code is inconsistent',
    };
  }

  const expectedDigest = evidenceDigest({
    candidate_id: evidence.candidate_id,
    source_digest: evidence.source_digest,
    recovery_ref: evidence.recovery_ref,
    byte_count: evidence.byte_count,
    cas_snapshot_digest: evidence.cas_snapshot_digest,
    status: evidence.status,
    failure_code: evidence.failure_code,
  });
  if (expectedDigest !== evidence.evidence_digest) {
    return {
      ok: false,
      code: 'invalid_recovery_evidence',
      detail: 'mechanical recovery evidence digest mismatch',
    };
  }

  if (!DIGEST.test(currentStoreSnapshotDigest)) {
    return {
      ok: false,
      code: 'invalid_recovery_evidence',
      detail: 'current CAS snapshot digest is malformed',
    };
  }
  if (evidence.cas_snapshot_digest !== currentStoreSnapshotDigest) {
    return {
      ok: false,
      code: 'stale_recovery_snapshot',
      detail: 'mechanical recovery evidence was issued against another CAS snapshot',
    };
  }

  return { ok: true };
}
