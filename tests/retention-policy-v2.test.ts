import { describe, expect, it } from 'vitest';
import { evaluateRetentionPolicyV2 } from '../src/lab/retention-policy-v2.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

const identity = {
  candidateId: 'cand-0001',
  originalOrdinal: 0,
  sourceDigest: d('a'),
  programDigest: d('b'),
};

function observation(patch: Record<string, number> = {}) {
  return {
    schema: 'anvil.semantic-observation-abi.v2' as const,
    ...identity,
    evidenceSufficient: patch.evidenceSufficient ?? 0.9,
    predicates: {
      stillNeeded: patch.stillNeeded ?? 0.9,
      fullContentNeeded: patch.fullContentNeeded ?? 0.1,
      unresolvedEvidence: patch.unresolvedEvidence ?? 0.1,
    },
    telemetry: { entropy: null, margin: null },
  };
}

function recovery(status: 'VERIFIED' | 'MISSING' | 'DIGEST_MISMATCH' | 'STALE' = 'VERIFIED') {
  return {
    schema: 'anvil.mechanical-recovery-attestation.v1' as const,
    candidateId: identity.candidateId,
    sourceDigest: identity.sourceDigest,
    recoveryRef: 'cas:object-1',
    status,
  };
}

const thresholds = {
  evidenceSufficientFloor: 0.5,
  retainFloor: 0.5,
  fullContentFloor: 0.8,
  unresolvedReviewFloor: 0.8,
};

describe('retention policy v2', () => {
  it('abstains before all semantic policy when evidence is insufficient', () => {
    expect(evaluateRetentionPolicyV2(
      identity,
      observation({ evidenceSufficient: 0.2 }),
      recovery(),
      thresholds,
    )).toMatchObject({ disposition: 'ABSTAIN', authorityGranted: false });
  });

  it('uses still-needed then full-content-needed for retained evidence', () => {
    expect(evaluateRetentionPolicyV2(
      identity,
      observation({ stillNeeded: 0.9, fullContentNeeded: 0.1 }),
      recovery(),
      thresholds,
    )).toMatchObject({ disposition: 'REFERENTIAL', authorityGranted: true });

    expect(evaluateRetentionPolicyV2(
      identity,
      observation({ stillNeeded: 0.9, fullContentNeeded: 0.95 }),
      recovery(),
      thresholds,
    )).toMatchObject({ disposition: 'FULL', authorityGranted: false });
  });

  it('treats unresolved evidence as a conservative advisory override, not proof of contradiction', () => {
    expect(evaluateRetentionPolicyV2(
      identity,
      observation({
        stillNeeded: 0.1,
        fullContentNeeded: 0.1,
        unresolvedEvidence: 0.95,
      }),
      recovery(),
      thresholds,
    )).toMatchObject({
      disposition: 'FULL',
      authorityGranted: false,
      reason: 'unresolved-evidence-review',
    });
  });

  it('evicts low-value resolved evidence only when mechanical recovery is verified', () => {
    expect(evaluateRetentionPolicyV2(
      identity,
      observation({
        stillNeeded: 0.1,
        fullContentNeeded: 0.1,
        unresolvedEvidence: 0.1,
      }),
      recovery('VERIFIED'),
      thresholds,
    )).toMatchObject({ disposition: 'EVICTED', authorityGranted: true });

    for (const status of ['MISSING', 'DIGEST_MISMATCH', 'STALE'] as const) {
      expect(evaluateRetentionPolicyV2(
        identity,
        observation({
          stillNeeded: 0.1,
          fullContentNeeded: 0.1,
          unresolvedEvidence: 0.1,
        }),
        recovery(status),
        thresholds,
      )).toMatchObject({ disposition: 'FULL', authorityGranted: false });
    }
  });

  it('uses profile-supplied sufficiency thresholds instead of a globally baked experiment threshold', () => {
    const obs = observation({ evidenceSufficient: 0.3 });

    expect(evaluateRetentionPolicyV2(
      identity,
      obs,
      recovery(),
      { ...thresholds, evidenceSufficientFloor: 0.25 },
    ).disposition).toBe('REFERENTIAL');

    expect(evaluateRetentionPolicyV2(
      identity,
      obs,
      recovery(),
      { ...thresholds, evidenceSufficientFloor: 0.5 },
    ).disposition).toBe('ABSTAIN');
  });
});
