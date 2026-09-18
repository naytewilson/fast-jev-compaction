import {
  fullPresentation,
  referentialPresentation,
  type ReplayCandidate,
  type ReplayDisposition,
  type ReplayPresentation,
} from './replay.js';
import {
  verifyMechanicalRecoveryEvidence,
  type MechanicalRecoveryAuthorityFailureCode,
  type MechanicalRecoveryEvidence,
  type MechanicalRecoveryStatus,
} from './mechanical-recovery.js';
import type { SemanticCandidateObservationV2 } from './semantic-contract-v2.js';
import { sha256Digest } from './recovery.js';

export interface ObservationPolicyThresholdsV2 {
  evidenceSufficientFloor: number;
  retain: number;
  keepFull: number;
  reviewFloor: number;
}

export const SEMANTIC_POLICY_REASONS_V2 = [
  'insufficient_evidence',
  'review_advisory',
  'full_content_needed',
  'mechanical_recovery_unavailable',
  'not_still_needed',
  'reversible_reference',
] as const;

export type SemanticPolicyReasonV2 =
  (typeof SEMANTIC_POLICY_REASONS_V2)[number];

export const SEMANTIC_POLICY_SPEC_V2 = Object.freeze({
  schema: 'anvil.semantic-policy-spec.v2' as const,
  gateOrder: Object.freeze([
    'evidence_sufficient',
    'still_needed',
    'full_content_needed',
    'unresolved_evidence',
    'mechanical_recovery',
  ]),
  evidenceAuthority: 'first-gate' as const,
  unresolvedEvidenceAuthority: 'review-advisory-after-evidence-gate' as const,
  recoverabilityAuthority: 'mechanical-only' as const,
  recoveryProof: 'issued-and-current-store-snapshot-bound' as const,
  dispositions: Object.freeze([
    'ABSTAIN',
    'FULL',
    'REFERENTIAL',
    'EVICTED',
  ]),
  reasons: SEMANTIC_POLICY_REASONS_V2,
});

export const SEMANTIC_POLICY_SPEC_DIGEST_V2 =
  sha256Digest(JSON.stringify(SEMANTIC_POLICY_SPEC_V2));

export interface SemanticPolicyDecisionV2 {
  candidate_id: string;
  source_digest: string;
  disposition: Exclude<ReplayDisposition, 'PRISTINE_FALLBACK'>;
  semantic_authority_used: boolean;
  review_advisory: boolean;
  reason: SemanticPolicyReasonV2;
  mechanical_recovery_status: MechanicalRecoveryStatus;
  recovery_failure_code: MechanicalRecoveryAuthorityFailureCode | null;
  mechanical_recovery_evidence_digest: string;
}

export interface SemanticPolicyResultV2 {
  decision: Readonly<SemanticPolicyDecisionV2>;
  presentation: Readonly<ReplayPresentation>;
}

export interface SemanticPolicyInputV2 {
  candidate: ReplayCandidate;
  observation: SemanticCandidateObservationV2;
  thresholds: ObservationPolicyThresholdsV2;
  recovery: MechanicalRecoveryEvidence;
  currentStoreSnapshotDigest: string;
}

interface RecoveryAuthorityState {
  status: MechanicalRecoveryStatus;
  failureCode: MechanicalRecoveryAuthorityFailureCode | null;
  evidenceDigest: string;
}

function probability(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(field + ' threshold must be finite in [0,1]');
  }
}

export function validateObservationPolicyThresholdsV2(
  thresholds: ObservationPolicyThresholdsV2,
): void {
  probability(thresholds.evidenceSufficientFloor, 'evidenceSufficientFloor');
  probability(thresholds.retain, 'retain');
  probability(thresholds.keepFull, 'keepFull');
  probability(thresholds.reviewFloor, 'reviewFloor');
}

function recoveryAuthority(
  input: SemanticPolicyInputV2,
): RecoveryAuthorityState {
  const verification = verifyMechanicalRecoveryEvidence(
    input.candidate,
    input.recovery,
    input.currentStoreSnapshotDigest,
  );

  if (!verification.ok) {
    if (verification.code === 'recovery_identity_mismatch') {
      throw new Error(verification.detail);
    }
    return {
      status: 'UNAVAILABLE',
      failureCode: verification.code,
      evidenceDigest:
        typeof (input.recovery as any)?.evidence_digest === 'string'
          ? (input.recovery as any).evidence_digest
          : sha256Digest('UNISSUED_RECOVERY_EVIDENCE'),
    };
  }

  return {
    status: input.recovery.status,
    failureCode: input.recovery.failure_code,
    evidenceDigest: input.recovery.evidence_digest,
  };
}

function decision(
  candidate: ReplayCandidate,
  recovery: RecoveryAuthorityState,
  disposition: SemanticPolicyDecisionV2['disposition'],
  reason: SemanticPolicyReasonV2,
  semanticAuthorityUsed: boolean,
  reviewAdvisory: boolean,
): Readonly<SemanticPolicyDecisionV2> {
  return Object.freeze({
    candidate_id: candidate.candidate_id,
    source_digest: candidate.recovery.source_digest,
    disposition,
    semantic_authority_used: semanticAuthorityUsed,
    review_advisory: reviewAdvisory,
    reason,
    mechanical_recovery_status: recovery.status,
    recovery_failure_code: recovery.failureCode,
    mechanical_recovery_evidence_digest: recovery.evidenceDigest,
  });
}

function evictedPresentation(candidate: ReplayCandidate): ReplayPresentation {
  return Object.freeze({
    candidate_id: candidate.candidate_id,
    disposition: 'EVICTED' as const,
    visible_text: '',
    source_digest: candidate.recovery.source_digest,
    omitted_bytes: candidate.recovery.byte_count,
    recovery_required: true,
  });
}

export function decideSemanticPolicyV2(
  input: SemanticPolicyInputV2,
): Readonly<SemanticPolicyResultV2> {
  validateObservationPolicyThresholdsV2(input.thresholds);
  if (input.candidate.candidate_id !== input.observation.candidate_id) {
    throw new Error('candidate identity does not match semantic observation');
  }

  const candidate = input.candidate;
  const observation = input.observation;
  const recovery = recoveryAuthority(input);

  if (
    observation.evidence_sufficient.noul <
    input.thresholds.evidenceSufficientFloor
  ) {
    return Object.freeze({
      decision: decision(
        candidate,
        recovery,
        'ABSTAIN',
        'insufficient_evidence',
        false,
        false,
      ),
      presentation: Object.freeze(fullPresentation(candidate, 'ABSTAIN')),
    });
  }

  if (observation.still_needed.noul < input.thresholds.retain) {
    if (
      observation.unresolved_evidence.noul >=
      input.thresholds.reviewFloor
    ) {
      return Object.freeze({
        decision: decision(
          candidate,
          recovery,
          'FULL',
          'review_advisory',
          true,
          true,
        ),
        presentation: Object.freeze(fullPresentation(candidate)),
      });
    }
    if (recovery.status !== 'VERIFIED') {
      return Object.freeze({
        decision: decision(
          candidate,
          recovery,
          'FULL',
          'mechanical_recovery_unavailable',
          true,
          false,
        ),
        presentation: Object.freeze(fullPresentation(candidate)),
      });
    }
    return Object.freeze({
      decision: decision(
        candidate,
        recovery,
        'EVICTED',
        'not_still_needed',
        true,
        false,
      ),
      presentation: evictedPresentation(candidate),
    });
  }

  if (
    observation.full_content_needed.noul >=
    input.thresholds.keepFull
  ) {
    return Object.freeze({
      decision: decision(
        candidate,
        recovery,
        'FULL',
        'full_content_needed',
        true,
        false,
      ),
      presentation: Object.freeze(fullPresentation(candidate)),
    });
  }

  if (
    observation.unresolved_evidence.noul >=
    input.thresholds.reviewFloor
  ) {
    return Object.freeze({
      decision: decision(
        candidate,
        recovery,
        'FULL',
        'review_advisory',
        true,
        true,
      ),
      presentation: Object.freeze(fullPresentation(candidate)),
    });
  }

  if (recovery.status !== 'VERIFIED') {
    return Object.freeze({
      decision: decision(
        candidate,
        recovery,
        'FULL',
        'mechanical_recovery_unavailable',
        true,
        false,
      ),
      presentation: Object.freeze(fullPresentation(candidate)),
    });
  }

  return Object.freeze({
    decision: decision(
      candidate,
      recovery,
      'REFERENTIAL',
      'reversible_reference',
      true,
      false,
    ),
    presentation: Object.freeze(referentialPresentation(candidate)),
  });
}
