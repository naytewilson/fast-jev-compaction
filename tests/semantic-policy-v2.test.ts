import { describe, expect, it } from 'vitest';
import {
  decideSemanticPolicyV2,
  SEMANTIC_POLICY_REASONS_V2,
  SEMANTIC_POLICY_SPEC_DIGEST_V2,
} from '../src/lab/semantic-policy-v2.js';
import { createToolRecoveryManifest } from '../src/lab/recovery.js';
import type { MechanicalRecoveryEvidence } from '../src/lab/mechanical-recovery.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

const thresholds = {
  evidenceSufficientFloor: 0.8,
  retain: 0.5,
  keepFull: 0.8,
  reviewFloor: 0.8,
};

function candidate() {
  const stdout = 'head\ncritical\ntail';
  return {
    candidate_id: 'cand-policy-v2',
    stdout,
    stderr: '',
    exit_status: 0,
    head_lines: 1,
    tail_lines: 1,
    presentation_budget_bytes: 1000,
    recovery: createToolRecoveryManifest(stdout, '', 0, 'policy-v2-object'),
    critical_evidence: ['critical'],
  };
}

function observation(patch: Record<string, number> = {}) {
  return {
    candidate_id: 'cand-policy-v2',
    evidence_sufficient: { noul: patch.evidence_sufficient ?? 0.95 },
    still_needed: { noul: patch.still_needed ?? 0.9 },
    full_content_needed: { noul: patch.full_content_needed ?? 0.1 },
    unresolved_evidence: { noul: patch.unresolved_evidence ?? 0.1 },
  };
}

function recovery(
  status: 'VERIFIED' | 'UNAVAILABLE' = 'VERIFIED',
): MechanicalRecoveryEvidence {
  return {
    schema: 'anvil.mechanical-recovery-evidence.v1',
    candidate_id: 'cand-policy-v2',
    source_digest: candidate().recovery.source_digest,
    recovery_ref: candidate().recovery.recovery_ref,
    cas_snapshot_digest: d('1'),
    status,
    failure_code: status === 'VERIFIED' ? null : 'missing_object',
    evidence_digest: d(status === 'VERIFIED' ? '2' : '3'),
  };
}

describe('Semantic Fabric V2 deterministic policy engine', () => {
  it('has a closed V2 reason vocabulary and source-bound policy spec digest', () => {
    expect(SEMANTIC_POLICY_REASONS_V2).toEqual([
      'insufficient_evidence',
      'review_advisory',
      'full_content_needed',
      'mechanical_recovery_unavailable',
      'not_still_needed',
      'reversible_reference',
    ]);
    expect(SEMANTIC_POLICY_SPEC_DIGEST_V2).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('gives evidence sufficiency first authority over every downstream score', () => {
    const result = decideSemanticPolicyV2({
      candidate: candidate(),
      observation: observation({
        evidence_sufficient: 0.2,
        still_needed: 0.1,
        full_content_needed: 1,
        unresolved_evidence: 1,
      }),
      thresholds,
      recovery: recovery(),
    });
    expect(result.decision).toMatchObject({
      disposition: 'ABSTAIN',
      reason: 'insufficient_evidence',
      semantic_authority_used: false,
      review_advisory: false,
      mechanical_recovery_status: 'VERIFIED',
    });
  });

  it('keeps unresolved evidence advisory after the evidence gate, including the eviction lane', () => {
    const result = decideSemanticPolicyV2({
      candidate: candidate(),
      observation: observation({
        still_needed: 0.1,
        unresolved_evidence: 0.95,
      }),
      thresholds,
      recovery: recovery(),
    });
    expect(result.decision).toMatchObject({
      disposition: 'FULL',
      reason: 'review_advisory',
      review_advisory: true,
    });
  });

  it('requires exact mechanical recovery before eviction or referential presentation', () => {
    const evictBlocked = decideSemanticPolicyV2({
      candidate: candidate(),
      observation: observation({ still_needed: 0.1 }),
      thresholds,
      recovery: recovery('UNAVAILABLE'),
    });
    expect(evictBlocked.decision.reason).toBe('mechanical_recovery_unavailable');
    expect(evictBlocked.presentation.disposition).toBe('FULL');

    const evicted = decideSemanticPolicyV2({
      candidate: candidate(),
      observation: observation({ still_needed: 0.1 }),
      thresholds,
      recovery: recovery(),
    });
    expect(evicted.decision.reason).toBe('not_still_needed');
    expect(evicted.presentation.disposition).toBe('EVICTED');

    const referenceBlocked = decideSemanticPolicyV2({
      candidate: candidate(),
      observation: observation(),
      thresholds,
      recovery: recovery('UNAVAILABLE'),
    });
    expect(referenceBlocked.decision.reason)
      .toBe('mechanical_recovery_unavailable');

    const reference = decideSemanticPolicyV2({
      candidate: candidate(),
      observation: observation(),
      thresholds,
      recovery: recovery(),
    });
    expect(reference.decision).toMatchObject({
      disposition: 'REFERENTIAL',
      reason: 'reversible_reference',
      source_digest: candidate().recovery.source_digest,
      mechanical_recovery_evidence_digest: d('2'),
    });
    expect(reference.presentation.visible_text)
      .toContain('recovery=cas:policy-v2-object');
  });

  it('rejects cross-candidate recovery evidence and invalid thresholds', () => {
    expect(() => decideSemanticPolicyV2({
      candidate: candidate(),
      observation: observation(),
      thresholds,
      recovery: { ...recovery(), candidate_id: 'cand-other' },
    })).toThrow(/candidate|recovery/i);

    expect(() => decideSemanticPolicyV2({
      candidate: candidate(),
      observation: observation(),
      thresholds: { ...thresholds, reviewFloor: 1.1 },
      recovery: recovery(),
    })).toThrow(/threshold/i);
  });
});
