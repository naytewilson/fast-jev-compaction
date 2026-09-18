import { describe, expect, it } from 'vitest';
import {
  authorizeSyntheticSensorV2Egress,
  createSystemOneSensorV2Provider,
} from '../src/lab/system-one-sensor-v2.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

function request() {
  return {
    schema: 'anvil.mapped-decision-request.v0',
    request_id: 'mdr-four-axis',
    source_run_id: 'fixture-four-axis',
    decision_contract: {
      id: 'anvil.context-retention.v2',
      version: '2.0.0',
      digest: d('1'),
    },
    execution_profile: {
      id: 'typesafe-systemone-jev-1.13.0',
      version: '2.0.0',
      digest: d('2'),
    },
    calibration_profile: {
      id: 'shadow',
      version: '2.0.0',
      digest: d('3'),
    },
    policy_profile: {
      id: 'shadow',
      version: '2.0.0',
      digest: d('4'),
    },
    shared_conversation_state: {
      mission: 'preserve source-bound evidence',
      recent_turns: [],
      active_constraints: ['semantic recovery is forbidden'],
      unresolved_failures: [],
      source_refs: [d('5')],
    },
    candidate_views: [{
      candidate_id: 'cand-0001',
      source_digest: d('5'),
      source_kind: 'tool_result',
      recovery_ref: 'cas:object-1',
      byte_count: 100,
      hard_roots: {
        exit_status: 0,
        stderr: [],
        first_lines: ['head'],
        last_lines: ['tail'],
      },
      semantic_view: {
        head: 'head',
        tail: 'tail',
        selected_chunks: [],
        omitted_bytes: 80,
      },
    }],
  } as const;
}

describe('System One four-axis semantic sensor', () => {
  it('asks exactly four semantic questions and never asks recoverability', async () => {
    const req = request();
    let body: any;
    const provider = createSystemOneSensorV2Provider({
      apiKey: 'test-key',
      model: 'jev-1.13.0',
      egressGrants: [authorizeSyntheticSensorV2Egress(req as any)],
      fetch: async (_url, init) => {
        body = JSON.parse(init.body);
        const answers = Object.fromEntries(
          Object.keys(body.questions).map((key) => [key, { noul: 0.8 }]),
        );
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            model: 'jev-1.13.0',
            answers,
            usage: { input_tokens: 40, output_tokens: 8 },
          }),
        };
      },
    });

    const result = await provider(req as any);
    expect(Object.keys(body.questions)).toEqual([
      'cand-0001.evidence_sufficient',
      'cand-0001.still_needed',
      'cand-0001.full_content_needed',
      'cand-0001.unresolved_evidence',
    ]);
    expect(JSON.stringify(body.questions)).not.toContain('recoverable');
    expect(result.observations[0]).not.toHaveProperty('recoverable');
    expect(result.provider_metadata.input_tokens).toBe(40);
  });

  it('rejects extra recoverability answers from the provider', async () => {
    const req = request();
    const provider = createSystemOneSensorV2Provider({
      apiKey: 'test-key',
      model: 'jev-1.13.0',
      egressGrants: [authorizeSyntheticSensorV2Egress(req as any)],
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          model: 'jev-1.13.0',
          answers: {
            'cand-0001.evidence_sufficient': { noul: 0.8 },
            'cand-0001.still_needed': { noul: 0.8 },
            'cand-0001.full_content_needed': { noul: 0.2 },
            'cand-0001.unresolved_evidence': { noul: 0.1 },
            'cand-0001.recoverable': { noul: 1 },
          },
        }),
      }),
    });
    await expect(provider(req as any)).rejects.toThrow(/answer key set/i);
  });

  it('keeps exact pinned model and exact egress-grant requirements', async () => {
    expect(() => createSystemOneSensorV2Provider({
      apiKey: 'test-key',
      model: 'jev-latest',
    })).toThrow(/pinned/i);

    const req = request();
    const changed = { ...req, request_id: 'mdr-changed' };
    let calls = 0;
    const provider = createSystemOneSensorV2Provider({
      apiKey: 'test-key',
      model: 'jev-1.13.0',
      egressGrants: [authorizeSyntheticSensorV2Egress(req as any)],
      fetch: async () => {
        calls += 1;
        throw new Error('must not run');
      },
    });
    await expect(provider(changed as any)).rejects.toThrow(/egress grant/i);
    expect(calls).toBe(0);
  });
});
