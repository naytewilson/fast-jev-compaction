import { describe, expect, it } from 'vitest';
import {
  compareObservationProvidersV2,
} from '../src/lab/provider-comparison-v2.js';
import {
  SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
} from '../src/lab/semantic-contract-v2.js';
import { deriveProviderExecutionProfile } from '../src/lab/provider-profile.js';
import {
  InMemoryCAS,
  createToolRecoveryManifest,
  encodeToolEvidence,
} from '../src/lab/recovery.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

function profile(
  providerId: string,
  providerKind: 'jev-system-one' | 'qwen-ane' | 'mavis',
  seed: string,
  abi = SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
) {
  return deriveProviderExecutionProfile({
    providerId,
    providerKind,
    modelIdentityDigest: d(seed),
    modelAssurance:
      providerKind === 'qwen-ane' ? 'contentVerified' : 'opaqueVersioned',
    executionSemanticsDigest: d(seed === '1' ? '2' : seed === '5' ? '6' : '7'),
    normalizerDigest: d('8'),
    observationABIDigest: abi,
  });
}

function profiles(p: ReturnType<typeof profile>) {
  return {
    decision_contract: {
      id: 'anvil.context-retention.v2',
      version: '2.0.0',
      digest: d('a'),
    },
    execution_profile: {
      id: p.providerId,
      version: '2.0.0',
      digest: p.providerProfileDigest,
    },
    calibration_profile: {
      id: 'shadow',
      version: '2.0.0',
      digest: d('b'),
    },
    policy_profile: {
      id: 'shadow',
      version: '2.0.0',
      digest: d('c'),
    },
  };
}

function trace(id: string) {
  const stdout = 'head\nsemantic middle evidence\ntail';
  return {
    trace_id: id,
    source_run_id: 'fixture-' + id,
    shared_state: 'preserve source-bound evidence',
    candidates: [{
      candidate_id: 'cand-' + id,
      stdout,
      stderr: '',
      exit_status: 0,
      head_lines: 1,
      tail_lines: 1,
      presentation_budget_bytes: 1000,
      recovery: createToolRecoveryManifest(stdout, '', 0, 'obj-' + id),
      critical_evidence: ['semantic middle evidence'],
    }],
  };
}

function putTrace(cas: InMemoryCAS, t: ReturnType<typeof trace>) {
  const candidate = t.candidates[0];
  cas.put(
    candidate.recovery.recovery_ref.slice(4),
    encodeToolEvidence(
      candidate.stdout,
      candidate.stderr,
      candidate.exit_status,
    ),
  );
}

function envelope(
  values = {
    evidence_sufficient: 0.95,
    still_needed: 0.9,
    full_content_needed: 0.1,
    unresolved_evidence: 0.1,
  },
  inputTokens: number | null = 10,
  outputTokens: number | null = 2,
) {
  return async (request: any) => ({
    mapped_response: {
      schema: 'anvil.semantic-decision-response.v2',
      request_id: request.request_id,
      observations: request.candidate_views.map((candidate: any) => ({
        candidate_id: candidate.candidate_id,
        evidence_sufficient: { noul: values.evidence_sufficient },
        still_needed: { noul: values.still_needed },
        full_content_needed: { noul: values.full_content_needed },
        unresolved_evidence: { noul: values.unresolved_evidence },
      })),
    },
    provider_metadata: {
      requested_model: 'fixture-model',
      effective_model: 'fixture-model',
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: null,
    },
  });
}

const thresholds = {
  evidenceSufficientFloor: 0.8,
  retain: 0.5,
  keepFull: 0.8,
  reviewFloor: 0.8,
};

describe('provider-neutral semantic comparison V2', () => {
  it('compares the same four-axis ABI in separate provider namespaces', async () => {
    const jev = profile(
      'typesafe-system-one/jev-1.13.0',
      'jev-system-one',
      '1',
    );
    const qwen = profile('neo/qwen-ane', 'qwen-ane', '5');
    const t = trace('same');
    const cas = new InMemoryCAS();
    putTrace(cas, t);

    const result = await compareObservationProvidersV2(
      [t],
      cas,
      thresholds,
      [
        {
          profile: jev,
          observationProfiles: profiles(jev),
          provider: envelope(),
        },
        {
          profile: qwen,
          observationProfiles: profiles(qwen),
          provider: envelope(),
        },
      ],
    );

    expect(result.schema).toBe('anvil.provider-comparison.v2');
    expect(result.observationABIDigest).toBe(SEMANTIC_OBSERVATION_ABI_DIGEST_V2);
    expect(result.arms).toHaveLength(2);
    expect(result.arms[0].providerProfileDigest)
      .not.toBe(result.arms[1].providerProfileDigest);
    expect(result.arms[0].modeledObservationMeans).toEqual({
      evidence_sufficient: 0.95,
      still_needed: 0.9,
      full_content_needed: 0.1,
      unresolved_evidence: 0.1,
    });
    expect(result.arms[0].modeledObservationCount).toBe(1);
  });

  it('reports recovery only from the mechanical plane, never as a modeled score', async () => {
    const jev = profile(
      'typesafe-system-one/jev-1.13.0',
      'jev-system-one',
      '1',
    );
    const t = trace('mechanical');
    const cas = new InMemoryCAS();
    putTrace(cas, t);

    const result = await compareObservationProvidersV2(
      [t],
      cas,
      thresholds,
      [{
        profile: jev,
        observationProfiles: profiles(jev),
        provider: envelope(),
      }],
    );

    expect(result.arms[0].mechanicalRecovery).toEqual({
      verified: 1,
      unavailable: 0,
    });
    expect(result.arms[0].modeledObservationMeans)
      .not.toHaveProperty('recoverable');
    expect(JSON.stringify(result.arms[0].modeledObservationMeans))
      .not.toMatch(/recoverab/i);
  });

  it('isolates a provider failure without poisoning other provider arms', async () => {
    const jev = profile(
      'typesafe-system-one/jev-1.13.0',
      'jev-system-one',
      '1',
    );
    const qwen = profile('neo/qwen-ane', 'qwen-ane', '5');
    const t = trace('failure');
    const cas = new InMemoryCAS();
    putTrace(cas, t);

    const result = await compareObservationProvidersV2(
      [t],
      cas,
      thresholds,
      [
        {
          profile: jev,
          observationProfiles: profiles(jev),
          provider: async () => { throw new Error('offline'); },
        },
        {
          profile: qwen,
          observationProfiles: profiles(qwen),
          provider: envelope(),
        },
      ],
    );

    const jevResult = result.arms.find(
      (arm) => arm.providerId === jev.providerId,
    )!;
    const qwenResult = result.arms.find(
      (arm) => arm.providerId === qwen.providerId,
    )!;

    expect(jevResult.providerFailures).toBe(1);
    expect(jevResult.pristineFallbacks).toBe(1);
    expect(jevResult.modeledObservationCount).toBe(0);
    expect(jevResult.mechanicalRecovery).toEqual({
      verified: 1,
      unavailable: 0,
    });
    expect(qwenResult.providerFailures).toBe(0);
    expect(qwenResult.modeledObservationCount).toBe(1);
  });

  it('rejects provider profiles that do not bind the canonical V2 ABI', async () => {
    const old = profile(
      'typesafe-system-one/jev-1.13.0',
      'jev-system-one',
      '1',
      d('0'),
    );

    await expect(compareObservationProvidersV2(
      [],
      new InMemoryCAS(),
      thresholds,
      [{
        profile: old,
        observationProfiles: profiles(old),
        provider: envelope(),
      }],
    )).rejects.toThrow(/Observation ABI/i);
  });

  it('fails one provider closed if it attempts to return semantic recoverability', async () => {
    const jev = profile(
      'typesafe-system-one/jev-1.13.0',
      'jev-system-one',
      '1',
    );
    const qwen = profile('neo/qwen-ane', 'qwen-ane', '5');
    const t = trace('contamination');
    const cas = new InMemoryCAS();
    putTrace(cas, t);

    const contaminated = async (request: any) => ({
      schema: 'anvil.semantic-decision-response.v2',
      request_id: request.request_id,
      observations: [{
        candidate_id: request.candidate_views[0].candidate_id,
        evidence_sufficient: { noul: 0.95 },
        still_needed: { noul: 0.9 },
        full_content_needed: { noul: 0.1 },
        unresolved_evidence: { noul: 0.1 },
        recoverable: { noul: 1 },
      }],
    });

    const result = await compareObservationProvidersV2(
      [t],
      cas,
      thresholds,
      [
        {
          profile: jev,
          observationProfiles: profiles(jev),
          provider: contaminated,
        },
        {
          profile: qwen,
          observationProfiles: profiles(qwen),
          provider: envelope(),
        },
      ],
    );

    const jevResult = result.arms.find(
      (arm) => arm.providerId === jev.providerId,
    )!;
    const qwenResult = result.arms.find(
      (arm) => arm.providerId === qwen.providerId,
    )!;

    expect(jevResult.pristineFallbacks).toBe(1);
    expect(jevResult.providerFailures).toBe(1);
    expect(qwenResult.pristineFallbacks).toBe(0);
  });

  it('does not fabricate token totals when provider telemetry is incomplete', async () => {
    const jev = profile(
      'typesafe-system-one/jev-1.13.0',
      'jev-system-one',
      '1',
    );
    const traces = [trace('a'), trace('b')];
    const cas = new InMemoryCAS();
    traces.forEach((t) => putTrace(cas, t));

    let calls = 0;
    const provider = async (request: any) => {
      calls += 1;
      return envelope(
        undefined,
        calls === 1 ? 10 : null,
        calls === 1 ? 2 : null,
      )(request);
    };

    const result = await compareObservationProvidersV2(
      traces,
      cas,
      thresholds,
      [{
        profile: jev,
        observationProfiles: profiles(jev),
        provider,
      }],
    );

    expect(result.arms[0].semanticInputTokens).toBeNull();
    expect(result.arms[0].semanticOutputTokens).toBeNull();
  });

  it('contains no authority credential or production activation fields', async () => {
    const jev = profile(
      'typesafe-system-one/jev-1.13.0',
      'jev-system-one',
      '1',
    );
    const t = trace('no-authority');
    const cas = new InMemoryCAS();
    putTrace(cas, t);

    const result = await compareObservationProvidersV2(
      [t],
      cas,
      thresholds,
      [{
        profile: jev,
        observationProfiles: profiles(jev),
        provider: envelope(),
      }],
    );

    expect(JSON.stringify(result))
      .not.toMatch(/authorityIdentity|credential|productionAuthorityGranted/);
  });
});
