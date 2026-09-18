import { describe, expect, it } from 'vitest';
import {
  deriveSemanticPolicyProfileV2,
  verifySemanticPolicyProfileV2,
} from '../src/lab/semantic-policy-profile-v2.js';

const thresholds = {
  evidenceSufficientFloor: 0.8,
  retain: 0.5,
  keepFull: 0.8,
  reviewFloor: 0.8,
};

describe('SemanticPolicyProfile V2', () => {
  it('binds exact thresholds to the V2 policy semantics', () => {
    const profile = deriveSemanticPolicyProfileV2({
      id: 'jev-v2-shadow-policy',
      version: '2.0.0',
      thresholds,
    });
    expect(profile.schema).toBe('anvil.semantic-policy-profile.v2');
    expect(profile.policyProfileDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(profile.thresholdDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(profile.policySemanticsDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(verifySemanticPolicyProfileV2(profile)).toBe(true);
  });

  it('changes identity when any threshold changes', () => {
    const a = deriveSemanticPolicyProfileV2({
      id: 'jev-v2-shadow-policy',
      version: '2.0.0',
      thresholds,
    });
    const b = deriveSemanticPolicyProfileV2({
      id: 'jev-v2-shadow-policy',
      version: '2.0.0',
      thresholds: { ...thresholds, reviewFloor: 0.9 },
    });
    expect(a.thresholdDigest).not.toBe(b.thresholdDigest);
    expect(a.policyProfileDigest).not.toBe(b.policyProfileDigest);
  });

  it('detects tampering and rejects malformed thresholds', () => {
    const profile = deriveSemanticPolicyProfileV2({
      id: 'jev-v2-shadow-policy',
      version: '2.0.0',
      thresholds,
    });
    expect(verifySemanticPolicyProfileV2({
      ...profile,
      thresholds: { ...profile.thresholds, retain: 0.25 },
    } as any)).toBe(false);

    expect(() => deriveSemanticPolicyProfileV2({
      id: 'jev-v2-shadow-policy',
      version: '2.0.0',
      thresholds: { ...thresholds, evidenceSufficientFloor: Number.NaN },
    })).toThrow(/threshold|finite/i);
  });
});
