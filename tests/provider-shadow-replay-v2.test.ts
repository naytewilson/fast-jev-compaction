import { describe, expect, it } from 'vitest';
import {
  ProviderShadowReplayCompilerV2,
  compileProviderShadowCampaignV2,
  verifyProviderShadowReplayArtifactV2,
} from '../src/lab/provider-shadow-replay-v2.js';
import {
  compileContextRetentionProgramV2,
  SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
} from '../src/lab/semantic-contract-v2.js';
import {
  InMemoryCAS,
  createToolRecoveryManifest,
  encodeToolEvidence,
  sha256Digest,
} from '../src/lab/recovery.js';
import {
  makeProviderProfileV2,
  d2,
} from './v2-calibration-fixtures.js';

const thresholds = {
  evidenceSufficientFloor: 0.8,
  retain: 0.5,
  keepFull: 0.8,
  reviewFloor: 0.8,
};

function trace() {
  const stdout = 'head\nsemantic middle evidence\ntail';
  return {
    trace_id: 'shadow-v2',
    source_run_id: 'fixture-shadow-v2',
    shared_state: 'preserve evidence',
    candidates: [{
      candidate_id: 'cand-a',
      stdout,
      stderr: '',
      exit_status: 0,
      head_lines: 1,
      tail_lines: 1,
      presentation_budget_bytes: 1000,
      recovery: createToolRecoveryManifest(stdout, '', 0, 'shadow-v2-a'),
      critical_evidence: ['semantic middle evidence'],
    }],
  };
}

function labels(t: ReturnType<typeof trace>) {
  return [
    'evidence_sufficient',
    'still_needed',
    'full_content_needed',
    'unresolved_evidence',
  ].map((predicateId, index) => ({
    labelId: `label-${predicateId}`,
    authority: 'STRONG' as const,
    decisionContractDigest: d2('a'),
    predicateId: predicateId as any,
    labelBindingDigest: d2('b'),
    sourceDigest: t.candidates[0].recovery.source_digest,
    outcomeDigest: sha256Digest(`outcome:${predicateId}`),
    target: index % 2 === 0 ? 1 as const : 0 as const,
    verifierIdentity: 'fixture-verifier',
  }));
}

function provider(request: any) {
  return {
    schema: 'anvil.semantic-decision-response.v2',
    request_id: request.request_id,
    observations: [{
      candidate_id: 'cand-a',
      evidence_sufficient: { noul: 0.91 },
      still_needed: { noul: 0.82 },
      full_content_needed: { noul: 0.13 },
      unresolved_evidence: { noul: 0.17 },
    }],
  };
}

describe('ProviderShadowReplayCompilerV2', () => {
  it('emits four source-bound predictions and no semantic recovery prediction', async () => {
    const p = makeProviderProfileV2();
    expect(p.observationABIDigest).toBe(SEMANTIC_OBSERVATION_ABI_DIGEST_V2);
    const program = compileContextRetentionProgramV2({
      id: 'anvil.context-retention.v2',
      version: '2.0.0',
      digest: d2('a'),
    });
    const t = trace();
    const cas = new InMemoryCAS();
    cas.put(
      'shadow-v2-a',
      encodeToolEvidence(t.candidates[0].stdout, '', 0),
    );

    const artifact = await new ProviderShadowReplayCompilerV2().compile({
      providerProfile: p,
      observationProfiles: {
        decision_contract: {
          id: 'anvil.context-retention.v2',
          version: '2.0.0',
          digest: d2('a'),
        },
        execution_profile: {
          id: p.providerId,
          version: '2.0.0',
          digest: p.providerProfileDigest,
        },
        calibration_profile: {
          id: 'shadow',
          version: '2.0.0',
          digest: d2('c'),
        },
        policy_profile: {
          id: 'shadow',
          version: '2.0.0',
          digest: d2('d'),
        },
      },
      compiledProgramDigest: program.programDigest,
      provider,
      traces: [t],
      labels: labels(t),
      cas,
      thresholds,
    });

    expect(artifact.schema).toBe('anvil.provider-shadow-replay.v2');
    expect(artifact.predictions).toHaveLength(4);
    expect(artifact.predictions.map((x) => x.predicateId)).not.toContain('recoverable');
    expect(verifyProviderShadowReplayArtifactV2(artifact)).toBe(true);
  });

  it('rejects a recoverable label even if it is marked STRONG', async () => {
    const p = makeProviderProfileV2();
    const program = compileContextRetentionProgramV2({
      id: 'anvil.context-retention.v2',
      version: '2.0.0',
      digest: d2('a'),
    });
    const t = trace();
    const cas = new InMemoryCAS();
    cas.put('shadow-v2-a', encodeToolEvidence(t.candidates[0].stdout, '', 0));

    await expect(new ProviderShadowReplayCompilerV2().compile({
      providerProfile: p,
      observationProfiles: {
        decision_contract: {
          id: 'anvil.context-retention.v2',
          version: '2.0.0',
          digest: d2('a'),
        },
        execution_profile: {
          id: p.providerId,
          version: '2.0.0',
          digest: p.providerProfileDigest,
        },
        calibration_profile: { id: 'shadow', version: '2.0.0', digest: d2('c') },
        policy_profile: { id: 'shadow', version: '2.0.0', digest: d2('d') },
      },
      compiledProgramDigest: program.programDigest,
      provider,
      traces: [t],
      labels: [
        ...labels(t),
        {
          labelId: 'label-recoverable',
          authority: 'STRONG',
          decisionContractDigest: d2('a'),
          predicateId: 'recoverable' as any,
          labelBindingDigest: d2('b'),
          sourceDigest: t.candidates[0].recovery.source_digest,
          outcomeDigest: d2('e'),
          target: 1,
          verifierIdentity: 'fixture-verifier',
        },
      ],
      cas,
      thresholds,
    } as any)).rejects.toThrow(/recoverable|predicate/i);
  });
});


describe('Provider shadow campaign V2', () => {
  it('isolates provider failure while preserving successful provider artifacts', async () => {
    const jev = makeProviderProfileV2();
    const qwen = makeProviderProfileV2('neo/qwen-ane');
    const t = trace();
    const cas = new InMemoryCAS();
    cas.put('shadow-v2-a', encodeToolEvidence(t.candidates[0].stdout, '', 0));

    const program = compileContextRetentionProgramV2({
      id: 'anvil.context-retention.v2',
      version: '2.0.0',
      digest: d2('a'),
    });

    const observationProfiles = (p: typeof jev) => ({
      decision_contract: {
        id: 'anvil.context-retention.v2',
        version: '2.0.0',
        digest: d2('a'),
      },
      execution_profile: {
        id: p.providerId,
        version: '2.0.0',
        digest: p.providerProfileDigest,
      },
      calibration_profile: {
        id: 'shadow',
        version: '2.0.0',
        digest: d2('c'),
      },
      policy_profile: {
        id: 'shadow',
        version: '2.0.0',
        digest: d2('d'),
      },
    });

    const result = await compileProviderShadowCampaignV2({
      traces: [t],
      labels: labels(t),
      cas,
      thresholds,
      arms: [
        {
          providerProfile: jev,
          observationProfiles: observationProfiles(jev),
          compiledProgramDigest: program.programDigest,
          provider,
        },
        {
          providerProfile: qwen,
          observationProfiles: observationProfiles(qwen),
          compiledProgramDigest: program.programDigest,
          provider: async () => { throw new Error('offline'); },
        },
      ],
    });

    expect(result.schema).toBe('anvil.provider-shadow-campaign.v2');
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].providerProfileDigest)
      .toBe(jev.providerProfileDigest);
    expect(result.failures).toEqual([{
      providerId: qwen.providerId,
      providerProfileDigest: qwen.providerProfileDigest,
      code: 'shadow_replay_failed',
    }]);
  });

  it('rejects duplicate provider identities before any provider executes', async () => {
    const jev = makeProviderProfileV2();
    const t = trace();
    const cas = new InMemoryCAS();
    cas.put('shadow-v2-a', encodeToolEvidence(t.candidates[0].stdout, '', 0));
    const program = compileContextRetentionProgramV2({
      id: 'anvil.context-retention.v2',
      version: '2.0.0',
      digest: d2('a'),
    });

    let calls = 0;
    const counted = async (request: any) => {
      calls += 1;
      return provider(request);
    };
    const observationProfiles = {
      decision_contract: {
        id: 'anvil.context-retention.v2',
        version: '2.0.0',
        digest: d2('a'),
      },
      execution_profile: {
        id: jev.providerId,
        version: '2.0.0',
        digest: jev.providerProfileDigest,
      },
      calibration_profile: {
        id: 'shadow',
        version: '2.0.0',
        digest: d2('c'),
      },
      policy_profile: {
        id: 'shadow',
        version: '2.0.0',
        digest: d2('d'),
      },
    };

    await expect(compileProviderShadowCampaignV2({
      traces: [t],
      labels: labels(t),
      cas,
      thresholds,
      arms: [
        {
          providerProfile: jev,
          observationProfiles,
          compiledProgramDigest: program.programDigest,
          provider: counted,
        },
        {
          providerProfile: jev,
          observationProfiles,
          compiledProgramDigest: program.programDigest,
          provider: counted,
        },
      ],
    })).rejects.toThrow(/duplicate provider/i);

    expect(calls).toBe(0);
  });
});
