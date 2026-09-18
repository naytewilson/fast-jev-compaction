import type { ReplayCandidate } from './replay.js';
import {
  sha256Digest,
  type InMemoryCAS,
  type RecoveryVerification,
} from './recovery.js';

export type MechanicalRecoveryStatus = 'VERIFIED' | 'UNAVAILABLE';

export interface MechanicalRecoveryEvidence {
  schema: 'anvil.mechanical-recovery-evidence.v1';
  candidate_id: string;
  source_digest: string;
  recovery_ref: string;
  cas_snapshot_digest: string;
  status: MechanicalRecoveryStatus;
  failure_code:
    | null
    | 'missing_object'
    | 'digest_mismatch'
    | 'byte_count_mismatch'
    | 'candidate_mismatch';
  evidence_digest: string;
}

function outcome(
  verification: RecoveryVerification,
): Pick<MechanicalRecoveryEvidence, 'status' | 'failure_code'> {
  if (verification.ok) {
    return { status: 'VERIFIED', failure_code: null };
  }
  return {
    status: 'UNAVAILABLE',
    failure_code: verification.code,
  };
}

export function evaluateMechanicalRecovery(
  cas: InMemoryCAS,
  candidate: ReplayCandidate,
): Readonly<MechanicalRecoveryEvidence> {
  const verification = cas.verifyTool(
    candidate.recovery,
    candidate.stdout,
    candidate.stderr,
    candidate.exit_status,
  );
  const result = outcome(verification);
  const core = {
    schema: 'anvil.mechanical-recovery-evidence.v1' as const,
    candidate_id: candidate.candidate_id,
    source_digest: candidate.recovery.source_digest,
    recovery_ref: candidate.recovery.recovery_ref,
    cas_snapshot_digest: cas.snapshotDigest(),
    status: result.status,
    failure_code: result.failure_code,
  };
  return Object.freeze({
    ...core,
    evidence_digest: sha256Digest(JSON.stringify(core)),
  });
}
