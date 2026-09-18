import { describe, expect, it } from 'vitest';
import {
  ProviderShadowReplayV2Compiler,
  verifyProviderShadowReplayArtifactV2,
} from '../src/lab/provider-shadow-replay-v2.js';
import {
  SEMANTIC_SENSOR_ABI_V2_DIGEST,
  SEMANTIC_SENSOR_AXES_V2,
} from '../src/lab/observation-abi-v2.js';
import { deriveProviderExecutionProfile } from '../src/lab/provider-profile.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

function profile() {
  return deriveProviderExecutionProfile({
    providerId: 'typesafe-system-one/jev-1.13.0',
    providerKind: 'jev-system-one',
    modelIdentityDigest: d('1'),
    modelAssurance: 'opaqueVersioned',
    executionSemanticsDigest: d('2'),
    normalizerDigest: d('3'),
    observationABIDigest: SEMANTIC_SENSOR_ABI_V2_DIGEST,
  });
}

const programDigest = d('4');
const sourceDigest = d('5');
const decisionContractDigest = d('6');
const labelBindingDigest = d('7');

function lane() {
  return {
    candidateId: 'cand-0001',
    originalOrdinal: 0,
    sourceDigest,
    programDigest,
  };
}

function observation() {
  return {
    schema: 'anvil.semantic-observation-abi.v2' as const,
    ...lane(),
    evidenceSufficient: 0.61,
    predicates: {
      stillNeeded: 0.91,
      fullContentNeeded: 0.22,
      unresolvedEvidence: 0.17,
    },
    telemetry: { entropy: null, margin: null },
  };
}

function labels(authority: 'STRONG' | 'WEAK' = 'STRONG') {
  return SEMANTIC_SENSOR_AXES_V2.map((predicateId, index) => ({
    labelId: `label-${predicateId}`,
    authority,
    decisionContractDigest,
    predicateId,
    labelBindingDigest,
    sourceDigest,
    outcomeDigest: d((8 + index).toString(16)),
    target: index % 2 === 0 ? 1 as const : 0 as const,
    ...(authority === 'STRONG'
      ? { verifierIdentity: 'deterministic-v2-fixture' }
      : {}),
  }));
}

describe('ProviderShadowReplayV2Compiler', () => {
  it('compiles exactly four provider-bound semantic predictions', () => {
    const p = profile();
    const artifact = new ProviderShadowReplayV2Compiler().compile({
      providerProfile: p,
      decisionContractDigest,
      programDigest,
      laneIdentities: [lane()],
      observations: [observation()],
      labels: labels(),
      receiptDigests: [d('c')],
    });

    expect(artifact.schema).toBe('anvil.provider-shadow-replay.v2');
    expect(artifact.predictions).toHaveLength(4);
    expect(artifact.predictions.map((x) => x.predicateId))
      .toEqual([...SEMANTIC_SENSOR_AXES_V2]);
    expect(artifact.predictions.every(
      (x) => x.executionProfileDigest === p.providerProfileDigest,
    )).toBe(true);
    expect(artifact.predictions.some(
      (x) => x.predicateId === 'recoverable',
    )).toBe(false);
    expect(verifyProviderShadowReplayArtifactV2(artifact)).toBe(true);
  });

  it('rejects WEAK labels', () => {
    expect(() => new ProviderShadowReplayV2Compiler().compile({
      providerProfile: profile(),
      decisionContractDigest,
      programDigest,
      laneIdentities: [lane()],
      observations: [observation()],
      labels: labels('WEAK') as any,
      receiptDigests: [d('c')],
    })).toThrow(/STRONG/i);
  });

  it('rejects recoverable labels even if they are STRONG', () => {
    const recoverable = {
      labelId: 'label-recoverable',
      authority: 'STRONG',
      decisionContractDigest,
      predicateId: 'recoverable',
      labelBindingDigest,
      sourceDigest,
      outcomeDigest: d('d'),
      target: 1 as const,
      verifierIdentity: 'deterministic-v2-fixture',
    };

    expect(() => new ProviderShadowReplayV2Compiler().compile({
      providerProfile: profile(),
      decisionContractDigest,
      programDigest,
      laneIdentities: [lane()],
      observations: [observation()],
      labels: [...labels(), recoverable] as any,
      receiptDigests: [d('c')],
    })).toThrow(/recoverable|v2 predicate/i);
  });

  it('rejects lane/source/program mismatch before producing predictions', () => {
    expect(() => new ProviderShadowReplayV2Compiler().compile({
      providerProfile: profile(),
      decisionContractDigest,
      programDigest,
      laneIdentities: [lane()],
      observations: [{
        ...observation(),
        sourceDigest: d('e'),
      }],
      labels: labels(),
      receiptDigests: [d('c')],
    })).toThrow(/lane|identity|source/i);
  });

  it('rejects structural replay artifact copies', () => {
    const artifact = new ProviderShadowReplayV2Compiler().compile({
      providerProfile: profile(),
      decisionContractDigest,
      programDigest,
      laneIdentities: [lane()],
      observations: [observation()],
      labels: labels(),
      receiptDigests: [d('c')],
    });
    expect(verifyProviderShadowReplayArtifactV2({ ...artifact })).toBe(false);
  });
});
