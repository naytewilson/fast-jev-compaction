import { describe, expect, it } from 'vitest';
import {
  decideSemanticPolicy,
  SEMANTIC_POLICY_REASONS,
} from '../src/lab/semantic-policy.js';
import { createToolRecoveryManifest } from '../src/lab/recovery.js';

function candidate() {
  const stdout = 'head\ncritical\ntail';
  return {
    candidate_id: 'cand-policy',
    stdout,
    stderr: '',
    exit_status: 0,
    head_lines: 1,
    tail_lines: 1,
    presentation_budget_bytes: 1000,
    recovery: createToolRecoveryManifest(stdout, '', 0, 'policy-object'),
    critical_evidence: ['critical'],
  };
}

function observation(patch: Record<string, number> = {}) {
  return {
    candidate_id: 'cand-policy',
    evidence_sufficient: { noul: patch.evidence_sufficient ?? 0.95 },
    still_needed: { noul: patch.still_needed ?? 0.9 },
    full_content_needed: { noul: patch.full_content_needed ?? 0.1 },
    unresolved_evidence: { noul: patch.unresolved_evidence ?? 0.1 },
  };
}

const thresholds = { evidenceSufficientFloor: 0.8, keepFull: 0.8, retain: 0.5 };
const recoveryOK = { ok: true as const };
const recoveryMissing = {
  ok: false as const,
  code: 'missing_object' as const,
  detail: 'missing object',
};

describe('deterministic semantic policy engine', () => {
  it('has a closed reason vocabulary', () => {
    expect(SEMANTIC_POLICY_REASONS).toEqual([
      'evidence_deficit',
      'unresolved_review_required',
      'full_content_required',
      'mechanical_recovery_unavailable',
      'still_needed_reference',
      'evictable',
    ]);
  });

  it('gives evidence sufficiency first authority over downstream semantic scores', () => {
    const result = decideSemanticPolicy({
      candidate: candidate(),
      observation: observation({
        evidence_sufficient: 0.2,
        still_needed: 0.99,
        full_content_needed: 0.99,
        unresolved_evidence: 0.99,
      }),
      thresholds,
      recovery: recoveryOK,
    });
    expect(result.decision).toMatchObject({
      disposition: 'ABSTAIN',
      reason: 'evidence_deficit',
      mechanicalRecoveryVerified: true,
    });
  });

  it('treats unresolved evidence as review-required', () => {
    const result = decideSemanticPolicy({
      candidate: candidate(),
      observation: observation({ unresolved_evidence: 0.95 }),
      thresholds,
      recovery: recoveryOK,
    });
    expect(result.decision).toMatchObject({
      disposition: 'FULL',
      reason: 'unresolved_review_required',
    });
  });

  it('keeps full content before consulting recovery when full content is required', () => {
    const result = decideSemanticPolicy({
      candidate: candidate(),
      observation: observation({ full_content_needed: 0.95 }),
      thresholds,
      recovery: recoveryMissing,
    });
    expect(result.decision).toMatchObject({
      disposition: 'FULL',
      reason: 'full_content_required',
      mechanicalRecoveryVerified: false,
    });
  });

  it('requires mechanical recovery before referential presentation', () => {
    const result = decideSemanticPolicy({
      candidate: candidate(),
      observation: observation({ still_needed: 0.9, full_content_needed: 0.1 }),
      thresholds,
      recovery: recoveryMissing,
    });
    expect(result.decision).toMatchObject({
      disposition: 'FULL',
      reason: 'mechanical_recovery_unavailable',
    });
  });

  it('uses exact reference when still needed and recovery verifies', () => {
    const result = decideSemanticPolicy({
      candidate: candidate(),
      observation: observation({ still_needed: 0.9, full_content_needed: 0.1 }),
      thresholds,
      recovery: recoveryOK,
    });
    expect(result.decision).toMatchObject({
      disposition: 'REFERENTIAL',
      reason: 'still_needed_reference',
    });
    expect(result.presentation.visible_text).toContain('recovery=cas:policy-object');
  });

  it('requires mechanical recovery before eviction', () => {
    const blocked = decideSemanticPolicy({
      candidate: candidate(),
      observation: observation({ still_needed: 0.1 }),
      thresholds,
      recovery: recoveryMissing,
    });
    expect(blocked.decision.reason).toBe('mechanical_recovery_unavailable');

    const allowed = decideSemanticPolicy({
      candidate: candidate(),
      observation: observation({ still_needed: 0.1 }),
      thresholds,
      recovery: recoveryOK,
    });
    expect(allowed.decision).toMatchObject({
      disposition: 'EVICTED',
      reason: 'evictable',
    });
    expect(allowed.presentation.visible_text).toBe('');
  });

  it('rejects candidate identity mismatch and invalid thresholds', () => {
    expect(() => decideSemanticPolicy({
      candidate: candidate(),
      observation: { ...observation(), candidate_id: 'cand-other' },
      thresholds,
      recovery: recoveryOK,
    })).toThrow(/candidate/i);

    expect(() => decideSemanticPolicy({
      candidate: candidate(),
      observation: observation(),
      thresholds: { ...thresholds, evidenceSufficientFloor: 1.1 },
      recovery: recoveryOK,
    })).toThrow(/threshold/i);
  });
});
