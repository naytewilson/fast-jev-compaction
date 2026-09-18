import {
  validateSemanticSensorObservationV2,
  type SemanticSensorLaneIdentity,
  type SemanticSensorObservationV2,
} from './observation-abi-v2.js';
import {
  verifyMechanicalRecoveryAttestation,
  type MechanicalRecoveryAttestation,
} from './mechanical-recovery-v1.js';

export interface RetentionPolicyV2Thresholds {
  evidenceSufficientFloor: number;
  retainFloor: number;
  fullContentFloor: number;
  unresolvedReviewFloor: number;
}

export type RetentionPolicyV2Disposition =
  | 'FULL'
  | 'REFERENTIAL'
  | 'EVICTED'
  | 'ABSTAIN';

export interface RetentionPolicyV2Decision {
  disposition: RetentionPolicyV2Disposition;
  authorityGranted: boolean;
  reason:
    | 'invalid-observation'
    | 'invalid-recovery-attestation'
    | 'stale-recovery-attestation'
    | 'insufficient-evidence'
    | 'full-content-advisory'
    | 'retained-referential'
    | 'unresolved-evidence-review'
    | 'mechanical-recovery-unavailable'
    | 'low-value-recoverable';
}

function probability(
  value: number,
  field: string,
): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(
      `${field} must be finite in [0,1]`,
    );
  }
}

function validateThresholds(
  thresholds: RetentionPolicyV2Thresholds,
): void {
  probability(
    thresholds.evidenceSufficientFloor,
    'evidenceSufficientFloor',
  );
  probability(thresholds.retainFloor, 'retainFloor');
  probability(
    thresholds.fullContentFloor,
    'fullContentFloor',
  );
  probability(
    thresholds.unresolvedReviewFloor,
    'unresolvedReviewFloor',
  );
}

export function evaluateRetentionPolicyV2(
  identity: SemanticSensorLaneIdentity,
  observation: SemanticSensorObservationV2,
  recovery: MechanicalRecoveryAttestation,
  currentRecoverySnapshotDigest: string,
  thresholds: RetentionPolicyV2Thresholds,
): Readonly<RetentionPolicyV2Decision> {
  validateThresholds(thresholds);

  const observationValidation =
    validateSemanticSensorObservationV2(
      identity,
      observation,
    );
  if (!observationValidation.ok) {
    return Object.freeze({
      disposition: 'FULL' as const,
      authorityGranted: false,
      reason: 'invalid-observation' as const,
    });
  }

  const recoveryValidation =
    verifyMechanicalRecoveryAttestation(
      {
        candidateId: identity.candidateId,
        sourceDigest: identity.sourceDigest,
      },
      recovery,
      currentRecoverySnapshotDigest,
    );
  if (!recoveryValidation.ok) {
    return Object.freeze({
      disposition: 'FULL' as const,
      authorityGranted: false,
      reason:
        recoveryValidation.code === 'stale_recovery_snapshot'
          ? 'stale-recovery-attestation' as const
          : 'invalid-recovery-attestation' as const,
    });
  }

  if (
    observation.evidenceSufficient <
    thresholds.evidenceSufficientFloor
  ) {
    return Object.freeze({
      disposition: 'ABSTAIN' as const,
      authorityGranted: false,
      reason: 'insufficient-evidence' as const,
    });
  }

  if (
    observation.predicates.stillNeeded >=
    thresholds.retainFloor
  ) {
    if (
      observation.predicates.fullContentNeeded >=
      thresholds.fullContentFloor
    ) {
      return Object.freeze({
        disposition: 'FULL' as const,
        authorityGranted: false,
        reason: 'full-content-advisory' as const,
      });
    }

    if (recovery.status !== 'VERIFIED') {
      return Object.freeze({
        disposition: 'FULL' as const,
        authorityGranted: false,
        reason: 'mechanical-recovery-unavailable' as const,
      });
    }

    return Object.freeze({
      disposition: 'REFERENTIAL' as const,
      authorityGranted: true,
      reason: 'retained-referential' as const,
    });
  }

  if (
    observation.predicates.unresolvedEvidence >=
    thresholds.unresolvedReviewFloor
  ) {
    return Object.freeze({
      disposition: 'FULL' as const,
      authorityGranted: false,
      reason: 'unresolved-evidence-review' as const,
    });
  }

  if (recovery.status !== 'VERIFIED') {
    return Object.freeze({
      disposition: 'FULL' as const,
      authorityGranted: false,
      reason: 'mechanical-recovery-unavailable' as const,
    });
  }

  return Object.freeze({
    disposition: 'EVICTED' as const,
    authorityGranted: true,
    reason: 'low-value-recoverable' as const,
  });
}
