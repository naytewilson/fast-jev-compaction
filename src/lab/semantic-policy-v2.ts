import {
  fullPresentation,
  referentialPresentation,
  type ReplayCandidate,
  type ReplayDisposition,
  type ReplayPresentation,
} from './replay.js';
import type { MechanicalRecoveryEvidence } from './mechanical-recovery.js';
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
  mechanical_recovery_status: MechanicalRecoveryEvidence['status'];
  recovery_failure_code: MechanicalRecoveryEvidence['failure_code'];
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
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;

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

function validateRecoveryBinding(
  candidate: ReplayCandidate,
  recovery: MechanicalRecoveryEvidence,
): void {
  if (
    recovery.schema !== 'anvil.mechanical-recovery-evidence.v1' ||
    recovery.candidate_id !== candidate.candidate_id ||
    recovery.source_digest !== candidate.recovery.source_digest ||
    recovery.recovery_ref !== candidate.recovery.recovery_ref
  ) {
    throw new Error('mechanical recovery evidence does not bind the policy candidate');
  }
  if (
    !DIGEST.test(recovery.cas_snapshot_digest) ||
    !DIGEST.test(recovery.evidence_digest)
  ) {
    throw new TypeError('mechanical recovery evidence digests must be canonical sha256');
  }
  if (
    recovery.status === 'VERIFIED' &&
    recovery.failure_code !== null
  ) {
    throw new Error('verified mechanical recovery cannot carry a failure code');
  }
  if (
    recovery.status === 'UNAVAILABLE' &&
    recovery.failure_code === null
  ) {
    throw new Error('unavailable mechanical recovery requires a failure code');
  }
}

function decision(
  candidate: ReplayCandidate,
  recovery: MechanicalRecoveryEvidence,
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
    recovery_failure_code: recovery.failure_code,
    mechanical_recovery_evidence_digest: recovery.evidence_digest,
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
  validateRecoveryBinding(input.candidate, input.recovery);

  const candidate = input.candidate;
  const observation = input.observation;
  const recovery = input.recovery;

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
