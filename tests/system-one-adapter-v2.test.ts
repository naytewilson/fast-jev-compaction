import { describe, expect, it } from 'vitest';
import {
  authorizeSyntheticFixtureEgressV2,
  createSystemOneSemanticProviderV2,
  type SemanticDecisionRequestV2,
} from '../src/lab/system-one-adapter-v2.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

function request(): SemanticDecisionRequestV2 {
  return {
    schema: 'anvil.semantic-decision-request.v2',
    request_id: 'req-v2',
    source_run_id: 'fixture-v2',
    decision_contract: { id: 'anvil.context-retention.v2', version: '2.0.0', digest: d('a') },
    semantic_program: { id: 'anvil.context-retention.v2', version: '2.0.0', digest: d('b') },
    execution_profile: { id: 'typesafe-systemone-jev-1.13.0', version: '2.0.0', digest: d('c') },
    calibration_profile: { id: 'shadow', version: '2.0.0', digest: d('d') },
    policy_profile: { id: 'shadow', version: '2.0.0', digest: d('e') },
    shared_conversation_state: {
      mission: 'preserve evidence',
      recent_turns: [],
      active_constraints: ['observer only'],
      unresolved_failures: [],
      source_refs: [d('f')],
    },
    candidate_views: [{
      candidate_id: 'cand-a',
      source_digest: d('f'),
      source_kind: 'tool_result',
      recovery_ref: 'cas:v2-a',
      byte_count: 10,
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
        omitted_bytes: 1,
      },
    }],
  };
}

describe('System One semantic provider V2', () => {
  it('asks exactly four modeled questions per candidate and never asks recoverability', async () => {
    const req = request();
    let body: any;
    const provider = createSystemOneSemanticProviderV2({
      apiKey: 'test-key',
      model: 'jev-1.13.0',
      egressGrants: [authorizeSyntheticFixtureEgressV2(req)],
      fetch: async (_url, init) => {
        body = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            model: 'jev-1.13.0',
            answers: Object.fromEntries(
              Object.keys(body.questions).map((key) => [key, { type: 'noul', noul: 0.9 }]),
            ),
          }),
        };
      },
    });

    const result = await provider(req);
    expect(Object.keys(body.questions)).toEqual([
      'cand-a.evidence_sufficient',
      'cand-a.still_needed',
      'cand-a.full_content_needed',
      'cand-a.unresolved_evidence',
    ]);
    expect(JSON.stringify(body.questions)).not.toMatch(/recoverab/i);
    expect(result.mapped_response.observations[0]).not.toHaveProperty('recoverable');
  });

  it('rejects extra semantic recoverability answers fail-closed', async () => {
    const req = request();
    const provider = createSystemOneSemanticProviderV2({
      apiKey: 'test-key',
      model: 'jev-1.13.0',
      egressGrants: [authorizeSyntheticFixtureEgressV2(req)],
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          model: 'jev-1.13.0',
          answers: {
            'cand-a.evidence_sufficient': { type: 'noul', noul: 0.9 },
            'cand-a.still_needed': { type: 'noul', noul: 0.9 },
            'cand-a.full_content_needed': { type: 'noul', noul: 0.1 },
            'cand-a.unresolved_evidence': { type: 'noul', noul: 0.1 },
            'cand-a.recoverable': { type: 'noul', noul: 1 },
          },
        }),
      }),
    });

    await expect(provider(req)).rejects.toThrow(/answer key|unexpected|exact/i);
  });

  it('binds the compiled semantic program into the egress grant digest', () => {
    const a = request();
    const b = {
      ...a,
      semantic_program: { ...a.semantic_program, digest: d('0') },
    };
    const grant = authorizeSyntheticFixtureEgressV2(a);
    expect(authorizeSyntheticFixtureEgressV2(b).request_digest)
      .not.toBe(grant.request_digest);
  });
});
