import { describe, expect, it } from 'vitest';
import {
  deriveProviderExecutionProfile,
  verifyProviderExecutionProfile,
} from '../src/lab/provider-profile.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

const jev = {
  providerId: 'typesafe-system-one/jev-1.13.0',
  providerKind: 'jev-system-one' as const,
  modelIdentityDigest: d('1'),
  modelAssurance: 'opaqueVersioned' as const,
  executionSemanticsDigest: d('2'),
  normalizerDigest: d('3'),
  observationABIDigest: d('4'),
};

describe('ProviderExecutionProfile', () => {
  it('derives a stable provider profile identity', () => {
    const a = deriveProviderExecutionProfile(jev);
    const b = deriveProviderExecutionProfile(jev);
    expect(a.providerProfileDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(b.providerProfileDigest).toBe(a.providerProfileDigest);
    expect(verifyProviderExecutionProfile(a)).toBe(true);
  });

  it('changes identity across provider/model/execution/normalizer/ABI changes', () => {
    const baseline = deriveProviderExecutionProfile(jev).providerProfileDigest;
    for (const patch of [
      { providerId: 'typesafe-system-one/jev-1.14.0' },
      { modelIdentityDigest: d('5') },
      { executionSemanticsDigest: d('6') },
      { normalizerDigest: d('7') },
      { observationABIDigest: d('8') },
    ]) {
      expect(deriveProviderExecutionProfile({ ...jev, ...patch }).providerProfileDigest)
        .not.toBe(baseline);
    }
  });

  it('supports provider-specific assurance without granting authority', () => {
    const qwen = deriveProviderExecutionProfile({
      ...jev,
      providerId: 'neo/qwen-ane',
      providerKind: 'qwen-ane',
      modelIdentityDigest: d('5'),
      modelAssurance: 'contentVerified',
      executionSemanticsDigest: d('6'),
    });
    expect(qwen.modelAssurance).toBe('contentVerified');
    expect('authorityIdentity' in qwen).toBe(false);
    expect('productionAuthorityGranted' in qwen).toBe(false);
  });

  it('rejects an unknown provider kind even when TypeScript is bypassed', () => {
    expect(() => deriveProviderExecutionProfile({
      ...jev,
      providerKind: 'invented-provider',
    } as any)).toThrow(/providerKind/i);
  });

  it('rejects malformed or structurally widened profiles', () => {
    expect(() => deriveProviderExecutionProfile({
      ...jev,
      modelIdentityDigest: 'sha256:BAD',
    })).toThrow(/canonical sha256/i);

    const valid = deriveProviderExecutionProfile(jev);
    expect(verifyProviderExecutionProfile({ ...valid, extra: true })).toBe(false);
  });
});
