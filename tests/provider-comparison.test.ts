import { describe, expect, it } from 'vitest';
import { compareObservationProviders } from '../src/lab/provider-comparison.js';
import { deriveProviderExecutionProfile } from '../src/lab/provider-profile.js';
import {
  InMemoryCAS,
  createToolRecoveryManifest,
  encodeToolEvidence,
} from '../src/lab/recovery.js';

const d = (c: string) => 'sha256:' + c.repeat(64);
const ABI = d('4');

function providerProfile(providerId: string, providerKind: any, seed: string) {
  return deriveProviderExecutionProfile({
    providerId,
    providerKind,
    modelIdentityDigest: d(seed),
    modelAssurance: providerKind === 'qwen-ane' ? 'contentVerified' : 'opaqueVersioned',
    executionSemanticsDigest: d(seed === '1' ? '2' : '3'),
    normalizerDigest: d('8'),
    observationABIDigest: ABI,
  });
}

function observationProfiles(profile: ReturnType<typeof providerProfile>) {
  return {
    decision_contract: { id: 'anvil.context-retention.v1', version: '1.0.0', digest: d('a') },
    execution_profile: { id: profile.providerId, version: '1.0.0', digest: profile.providerProfileDigest },
    calibration_profile: { id: 'shadow', version: '1.0.0', digest: d('b') },
    policy_profile: { id: 'shadow-policy', version: '1.0.0', digest: d('c') },
  };
}

function trace(id: string) {
  const stdout = 'head\nsemantic middle evidence\ntail';
  return {
    trace_id: id,
    source_run_id: 'run-' + id,
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
  const c = t.candidates[0];
  cas.put(
    c.recovery.recovery_ref.slice(4),
    encodeToolEvidence(c.stdout, c.stderr, c.exit_status),
  );
}

function envelope(inputTokens: number | null = 10, outputTokens: number | null = 2) {
  return async (request: any) => ({
    mapped_response: {
      schema: 'anvil.mapped-decision-response.v1',
      request_id: request.request_id,
      observations: request.candidate_views.map((candidate: any) => ({
        candidate_id: candidate.candidate_id,
        evidence_sufficient: { noul: 0.95 },
        still_needed: { noul: 0.9 },
        full_content_needed: { noul: 0.1 },
        unresolved_evidence: { noul: 0.1 },
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
  keepFull: 0.8,
  retain: 0.5,
};

describe('provider-neutral semantic comparison', () => {
  it('keeps identical observations in separate provider namespaces', async () => {
    const jev = providerProfile('typesafe-system-one/jev-1.13.0', 'jev-system-one', '1');
    const qwen = providerProfile('neo/qwen-ane', 'qwen-ane', '5');
    const t = trace('one');
    const cas = new InMemoryCAS();
    putTrace(cas, t);

    const result = await compareObservationProviders(
      [t],
      cas,
      thresholds,
      ABI,
      [
        { profile: jev, observationProfiles: observationProfiles(jev), provider: envelope() },
        { profile: qwen, observationProfiles: observationProfiles(qwen), provider: envelope() },
      ],
    );

    expect(result.arms).toHaveLength(2);
    expect(result.arms[0].providerProfileDigest).not.toBe(result.arms[1].providerProfileDigest);
    expect(result.arms.every((arm) => arm.referentialPresentations === 1)).toBe(true);
  });

  it('isolates a provider failure to that provider arm', async () => {
    const jev = providerProfile('typesafe-system-one/jev-1.13.0', 'jev-system-one', '1');
    const qwen = providerProfile('neo/qwen-ane', 'qwen-ane', '5');
    const t = trace('isolation');
    const cas = new InMemoryCAS();
    putTrace(cas, t);

    const result = await compareObservationProviders(
      [t],
      cas,
      thresholds,
      ABI,
      [
        { profile: jev, observationProfiles: observationProfiles(jev), provider: async () => { throw new Error('offline'); } },
        { profile: qwen, observationProfiles: observationProfiles(qwen), provider: envelope() },
      ],
    );

    const jevResult = result.arms.find((arm) => arm.providerId === jev.providerId)!;
    const qwenResult = result.arms.find((arm) => arm.providerId === qwen.providerId)!;
    expect(jevResult.pristineFallbacks).toBe(1);
    expect(jevResult.providerFailures).toBe(1);
    expect(qwenResult.pristineFallbacks).toBe(0);
    expect(qwenResult.referentialPresentations).toBe(1);
  });

  it('rejects duplicate providers before execution', async () => {
    const jev = providerProfile('typesafe-system-one/jev-1.13.0', 'jev-system-one', '1');
    await expect(compareObservationProviders(
      [],
      new InMemoryCAS(),
      thresholds,
      ABI,
      [
        { profile: jev, observationProfiles: observationProfiles(jev), provider: envelope() },
        { profile: jev, observationProfiles: observationProfiles(jev), provider: envelope() },
      ],
    )).rejects.toThrow(/duplicate provider/i);
  });

  it('requires replay execution profile to equal the full provider profile digest', async () => {
    const jev = providerProfile('typesafe-system-one/jev-1.13.0', 'jev-system-one', '1');
    const profiles = observationProfiles(jev);
    profiles.execution_profile.digest = jev.executionSemanticsDigest;

    await expect(compareObservationProviders(
      [],
      new InMemoryCAS(),
      thresholds,
      ABI,
      [{ profile: jev, observationProfiles: profiles, provider: envelope() }],
    )).rejects.toThrow(/provider profile digest/i);
  });

  it('requires every provider to target the campaign Observation ABI', async () => {
    const jev = providerProfile('typesafe-system-one/jev-1.13.0', 'jev-system-one', '1');
    await expect(compareObservationProviders(
      [],
      new InMemoryCAS(),
      thresholds,
      d('9'),
      [{ profile: jev, observationProfiles: observationProfiles(jev), provider: envelope() }],
    )).rejects.toThrow(/Observation ABI/i);
  });

  it('does not expose authority or credentials in comparison results', async () => {
    const jev = providerProfile('typesafe-system-one/jev-1.13.0', 'jev-system-one', '1');
    const t = trace('no-authority');
    const cas = new InMemoryCAS();
    putTrace(cas, t);
    const result = await compareObservationProviders(
      [t], cas, thresholds, ABI,
      [{ profile: jev, observationProfiles: observationProfiles(jev), provider: envelope() }],
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/authorityIdentity|credential|productionAuthorityGranted|authorized/);
  });

  it('aggregates token usage only when every receipt reports it', async () => {
    const jev = providerProfile('typesafe-system-one/jev-1.13.0', 'jev-system-one', '1');
    const traces = [trace('a'), trace('b')];
    const cas = new InMemoryCAS();
    traces.forEach((t) => putTrace(cas, t));

    let calls = 0;
    const provider = async (request: any) => {
      calls += 1;
      return envelope(calls === 1 ? 10 : null, calls === 1 ? 2 : null)(request);
    };

    const result = await compareObservationProviders(
      traces, cas, thresholds, ABI,
      [{ profile: jev, observationProfiles: observationProfiles(jev), provider }],
    );
    expect(result.arms[0].semanticInputTokens).toBeNull();
    expect(result.arms[0].semanticOutputTokens).toBeNull();
  });
});
