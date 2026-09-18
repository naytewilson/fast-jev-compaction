import { describe, expect, it } from 'vitest';
import {
  compileProviderShadowCampaign,
  ProviderShadowReplayCompiler,
  verifyProviderShadowReplayArtifact,
} from '../src/lab/provider-shadow-replay.js';
import { deriveProviderExecutionProfile } from '../src/lab/provider-profile.js';
import { runObservationOnlyArm } from '../src/lab/observation-arm.js';
import {
  InMemoryCAS,
  createToolRecoveryManifest,
  encodeToolEvidence,
  sha256Digest,
} from '../src/lab/recovery.js';
import { MAPPED_OBSERVATION_AXES } from '../src/lab/types.js';
import type { SemanticCalibrationLabel } from '../src/lab/semantic-label.js';

const d = (c: string) => 'sha256:' + c.repeat(64);
const CONTRACT = d('a');
const ABI = d('b');

function profile(
  providerId = 'typesafe-system-one/jev-1.13.0',
  kind: 'jev-system-one' | 'qwen-ane' | 'mavis' = 'jev-system-one',
) {
  return deriveProviderExecutionProfile({
    providerId,
    providerKind: kind,
    modelIdentityDigest: kind === 'qwen-ane' ? d('2') : kind === 'mavis' ? d('3') : d('1'),
    modelAssurance: kind === 'qwen-ane' ? 'contentVerified' : 'opaqueVersioned',
    executionSemanticsDigest: kind === 'qwen-ane' ? d('5') : kind === 'mavis' ? d('6') : d('4'),
    normalizerDigest: d('7'),
    observationABIDigest: ABI,
  });
}

function profiles(p: ReturnType<typeof profile>) {
  return {
    decision_contract: { id: 'anvil.context-retention.v1', version: '1.0.0', digest: CONTRACT },
    execution_profile: { id: p.providerId, version: '1.0.0', digest: p.providerProfileDigest },
    calibration_profile: { id: 'shadow', version: '1.0.0', digest: d('c') },
    policy_profile: { id: 'shadow-policy', version: '1.0.0', digest: d('d') },
  };
}

function trace(id = 'one', stdout = 'head\nsemantic middle evidence\ntail') {
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

function labelsFor(t: ReturnType<typeof trace>, authority: 'STRONG' | 'WEAK' = 'STRONG') {
  return MAPPED_OBSERVATION_AXES.map((predicateId, index): SemanticCalibrationLabel => ({
    labelId: `${t.trace_id}-${predicateId}`,
    authority,
    decisionContractDigest: CONTRACT,
    predicateId,
    labelBindingDigest: d('e'),
    sourceDigest: t.candidates[0].recovery.source_digest,
    outcomeDigest: sha256Digest(`outcome:${t.trace_id}:${predicateId}`),
    target: index % 2 === 0 ? 1 : 0,
    ...(authority === 'STRONG' ? { verifierIdentity: 'deterministic-fixture' } : {}),
  }));
}

function put(cas: InMemoryCAS, t: ReturnType<typeof trace>) {
  const c = t.candidates[0];
  cas.put(
    c.recovery.recovery_ref.slice(4),
    encodeToolEvidence(c.stdout, c.stderr, c.exit_status),
  );
}

function envelope() {
  return async (request: any) => ({
    mapped_response: {
      schema: 'anvil.mapped-decision-response.v1',
      request_id: request.request_id,
      observations: request.candidate_views.map((candidate: any) => ({
        candidate_id: candidate.candidate_id,
        evidence_sufficient: { noul: 0.91 },
        still_needed: { noul: 0.82 },
        full_content_needed: { noul: 0.13 },
        unresolved_evidence: { noul: 0.17 },
      })),
    },
    provider_metadata: {
      requested_model: 'fixture-model',
      effective_model: 'fixture-model',
      input_tokens: 10,
      output_tokens: 2,
      cost_usd: null,
    },
  });
}

const thresholds = {
  evidenceSufficientFloor: 0.8,
  keepFull: 0.8,
  retain: 0.5,
};

describe('observation replay exposes validated shadow observations', () => {
  it('returns reassembled observations on a successful observation-only run', async () => {
    const p = profile();
    const t = trace();
    const cas = new InMemoryCAS();
    put(cas, t);

    const run = await runObservationOnlyArm(t, cas, profiles(p), thresholds, envelope());

    expect(run.observations).not.toBeNull();
    expect(run.observations?.[0].candidate_id).toBe(t.candidates[0].candidate_id);
    expect(run.observations?.[0].still_needed.noul).toBe(0.82);
  });
});

describe('ProviderShadowReplayCompiler', () => {
  it('materializes source-bound provider-specific predictions from one shadow replay', async () => {
    const p = profile();
    const t = trace();
    const cas = new InMemoryCAS();
    put(cas, t);

    const artifact = await new ProviderShadowReplayCompiler().compile({
      providerProfile: p,
      observationProfiles: profiles(p),
      provider: envelope(),
      traces: [t],
      labels: labelsFor(t),
      cas,
      thresholds,
    });

    expect(artifact.schema).toBe('anvil.provider-shadow-replay.v1');
    expect(artifact.providerProfileDigest).toBe(p.providerProfileDigest);
    expect(artifact.predictions).toHaveLength(4);
    expect(artifact.predictions.every((x) => x.executionProfileDigest === p.providerProfileDigest)).toBe(true);
    expect(artifact.predictions.find((x) => x.predicateId === 'still_needed')?.probability).toBe(0.82);
    expect(verifyProviderShadowReplayArtifact(artifact)).toBe(true);
  });

  it('rejects WEAK labels and decision-contract mismatch', async () => {
    const p = profile();
    const t = trace();
    const cas = new InMemoryCAS();
    put(cas, t);
    const compiler = new ProviderShadowReplayCompiler();

    await expect(compiler.compile({
      providerProfile: p,
      observationProfiles: profiles(p),
      provider: envelope(),
      traces: [t],
      labels: labelsFor(t, 'WEAK'),
      cas,
      thresholds,
    })).rejects.toThrow(/STRONG/i);

    await expect(compiler.compile({
      providerProfile: p,
      observationProfiles: {
        ...profiles(p),
        decision_contract: { ...profiles(p).decision_contract, digest: d('0') },
      },
      provider: envelope(),
      traces: [t],
      labels: labelsFor(t),
      cas,
      thresholds,
    })).rejects.toThrow(/decision contract/i);
  });

  it('fails closed when the provider cannot produce observations for labeled evidence', async () => {
    const p = profile();
    const t = trace();
    const cas = new InMemoryCAS();
    put(cas, t);

    await expect(new ProviderShadowReplayCompiler().compile({
      providerProfile: p,
      observationProfiles: profiles(p),
      provider: async () => { throw new Error('offline'); },
      traces: [t],
      labels: labelsFor(t),
      cas,
      thresholds,
    })).rejects.toThrow(/authoritative predictions|observation/i);
  });

  it('rejects ambiguous source evidence across traces', async () => {
    const p = profile();
    const t1 = trace('a', 'same\nsemantic middle evidence\nbytes');
    const t2 = trace('b', 'same\nsemantic middle evidence\nbytes');
    const cas = new InMemoryCAS();
    put(cas, t1);
    put(cas, t2);

    await expect(new ProviderShadowReplayCompiler().compile({
      providerProfile: p,
      observationProfiles: profiles(p),
      provider: envelope(),
      traces: [t1, t2],
      labels: labelsFor(t1),
      cas,
      thresholds,
    })).rejects.toThrow(/ambiguous source/i);
  });

  it('rejects structural replay-artifact copies', async () => {
    const p = profile();
    const t = trace();
    const cas = new InMemoryCAS();
    put(cas, t);
    const artifact = await new ProviderShadowReplayCompiler().compile({
      providerProfile: p,
      observationProfiles: profiles(p),
      provider: envelope(),
      traces: [t],
      labels: labelsFor(t),
      cas,
      thresholds,
    });

    expect(verifyProviderShadowReplayArtifact({ ...artifact })).toBe(false);
  });
});

describe('provider shadow campaign isolation', () => {
  it('keeps one provider failure from poisoning a successful provider artifact', async () => {
    const jev = profile();
    const qwen = profile('neo/qwen-ane', 'qwen-ane');
    const t = trace('campaign');
    const cas = new InMemoryCAS();
    put(cas, t);

    const result = await compileProviderShadowCampaign({
      traces: [t],
      labels: labelsFor(t),
      cas,
      thresholds,
      arms: [
        { providerProfile: jev, observationProfiles: profiles(jev), provider: envelope() },
        { providerProfile: qwen, observationProfiles: profiles(qwen), provider: async () => { throw new Error('offline'); } },
      ],
    });

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].providerProfileDigest).toBe(jev.providerProfileDigest);
    expect(result.failures).toEqual([{
      providerId: qwen.providerId,
      providerProfileDigest: qwen.providerProfileDigest,
      code: 'shadow_replay_failed',
    }]);
  });
});
