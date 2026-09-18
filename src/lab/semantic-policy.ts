import {
  fullPresentation,
  referentialPresentation,
  type ReplayCandidate,
  type ReplayDisposition,
  type ReplayPresentation,
} from './replay.js';
import type { RecoveryVerification } from './recovery.js';
import type { ObservationPolicyThresholds } from './observation-arm.js';
import type { MappedCandidateObservation } from './types.js';

export const SEMANTIC_POLICY_REASONS = [
  'evidence_deficit',
  'unresolved_review_required',
  'full_content_required',
  'mechanical_recovery_unavailable',
  'still_needed_reference',
  'evictable',
] as const;

export type SemanticPolicyReason =
  (typeof SEMANTIC_POLICY_REASONS)[number];

export interface SemanticPolicyDecision {
  candidateId: string;
  sourceDigest: string;
  disposition: Exclude<ReplayDisposition, 'PRISTINE_FALLBACK'>;
  reason: SemanticPolicyReason;
  mechanicalRecoveryVerified: boolean | null;
  recoveryFailureCode:
    | 'missing_object'
    | 'digest_mismatch'
    | 'byte_count_mismatch'
    | 'candidate_mismatch'
    | null;
}

export interface SemanticPolicyResult {
  decision: Readonly<SemanticPolicyDecision>;
  presentation: Readonly<ReplayPresentation>;
}

export interface SemanticPolicyInput {
  candidate: ReplayCandidate;
  observation: MappedCandidateObservation;
  thresholds: ObservationPolicyThresholds;
  recovery: RecoveryVerification | (() => RecoveryVerification);
}

function probability(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${field} threshold must be finite in [0,1]`);
  }
}

function validateThresholds(thresholds: ObservationPolicyThresholds): void {
  probability(thresholds.evidenceSufficientFloor, 'evidenceSufficientFloor');
  probability(thresholds.keepFull, 'keepFull');
  probability(thresholds.retain, 'retain');
}

function knownRecovery(
  recovery: SemanticPolicyInput['recovery'],
): RecoveryVerification | null {
  return typeof recovery === 'function' ? null : recovery;
}

function resolveRecovery(
  recovery: SemanticPolicyInput['recovery'],
): RecoveryVerification {
  return typeof recovery === 'function' ? recovery() : recovery;
}

function decision(
  candidate: ReplayCandidate,
  disposition: SemanticPolicyDecision['disposition'],
  reason: SemanticPolicyReason,
  recovery: RecoveryVerification | null,
): Readonly<SemanticPolicyDecision> {
  return Object.freeze({
    candidateId: candidate.candidate_id,
    sourceDigest: candidate.recovery.source_digest,
    disposition,
    reason,
    mechanicalRecoveryVerified: recovery === null ? null : recovery.ok,
    recoveryFailureCode:
      recovery === null || recovery.ok ? null : recovery.code,
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

export function decideSemanticPolicy(
  input: SemanticPolicyInput,
): Readonly<SemanticPolicyResult> {
  validateThresholds(input.thresholds);
  if (input.candidate.candidate_id !== input.observation.candidate_id) {
    throw new Error('candidate identity does not match semantic observation');
  }

  const known = knownRecovery(input.recovery);
  const observation = input.observation;
  const candidate = input.candidate;

  if (
    observation.evidence_sufficient.noul <
    input.thresholds.evidenceSufficientFloor
  ) {
    return Object.freeze({
      decision: decision(candidate, 'ABSTAIN', 'evidence_deficit', known),
      presentation: Object.freeze(fullPresentation(candidate, 'ABSTAIN')),
    });
  }

  if (observation.unresolved_evidence.noul >= input.thresholds.keepFull) {
    return Object.freeze({
      decision: decision(
        candidate,
        'FULL',
        'unresolved_review_required',
        known,
      ),
      presentation: Object.freeze(fullPresentation(candidate)),
    });
  }

  if (observation.still_needed.noul < input.thresholds.retain) {
    const recovery = resolveRecovery(input.recovery);
    if (!recovery.ok) {
      return Object.freeze({
        decision: decision(
          candidate,
          'FULL',
          'mechanical_recovery_unavailable',
          recovery,
        ),
        presentation: Object.freeze(fullPresentation(candidate)),
      });
    }
    return Object.freeze({
      decision: decision(candidate, 'EVICTED', 'evictable', recovery),
      presentation: evictedPresentation(candidate),
    });
  }

  if (observation.full_content_needed.noul >= input.thresholds.keepFull) {
    return Object.freeze({
      decision: decision(
        candidate,
        'FULL',
        'full_content_required',
        known,
      ),
      presentation: Object.freeze(fullPresentation(candidate)),
    });
  }

  const recovery = resolveRecovery(input.recovery);
  if (!recovery.ok) {
    return Object.freeze({
      decision: decision(
        candidate,
        'FULL',
        'mechanical_recovery_unavailable',
        recovery,
      ),
      presentation: Object.freeze(fullPresentation(candidate)),
    });
  }

  return Object.freeze({
    decision: decision(
      candidate,
      'REFERENTIAL',
      'still_needed_reference',
      recovery,
    ),
    presentation: Object.freeze(referentialPresentation(candidate)),
  });
}
