import { describe, expect, it } from 'vitest';
import { exportedFunction } from './lab-test-helpers.js';

const digest = (c: string) => 'sha256:' + c.repeat(64);

function mappedRequest() {
  return {
    schema: 'anvil.mapped-decision-request.v0',
    request_id: 'mdr-system-one',
    source_run_id: 'fixture-system-one',
    decision_contract: {
      id: 'anvil.context-retention.v1',
      version: '0.1.0',
      digest: digest('a'),
    },
    execution_profile: {
      id: 'typesafe-systemone-jev-1.13.0',
      version: '0.1.0',
      digest: digest('b'),
    },
    calibration_profile: {
      id: 'fixture-calibration',
      version: '0.1.0',
      digest: digest('c'),
    },
    policy_profile: {
      id: 'fixture-policy',
      version: '0.1.0',
      digest: digest('d'),
    },
    shared_conversation_state: {
      mission: 'preserve evidence',
      recent_turns: [],
      active_constraints: ['no production mutation'],
      unresolved_failures: [],
      source_refs: [digest('e')],
    },
    candidate_views: [{
      candidate_id: 'cand-0001',
      source_digest: digest('e'),
      source_kind: 'tool_result',
      recovery_ref: 'cas:fixture-1',
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
  };
}

describe('System One mapped execution adapter', () => {
  it('rejects floating jev-latest model identities before transport', async () => {
    const create = exportedFunction('createSystemOneMappedProvider');
    let calls = 0;
    expect(() => create({
      apiKey: 'test-key',
      model: 'jev-latest',
      fetch: async () => {
        calls += 1;
        throw new Error('must not run');
      },
    })).toThrow(/pinned/i);
    expect(calls).toBe(0);
  });

  it('uses one shared state with mechanically instantiated frozen questions', async () => {
    const create = exportedFunction('createSystemOneMappedProvider');
    const request = mappedRequest();
    let body: any;

    const authorize = exportedFunction('authorizeSyntheticFixtureEgress');
    const provider = create({
      apiKey: 'test-key',
      model: 'jev-1.13.0',
      egressGrants: [authorize(request)],
      fetch: async (_url: string, init: any) => {
        body = JSON.parse(init.body);
        const answers = Object.fromEntries(
          Object.keys(body.questions).map((key) => [key, { type: 'noul', noul: 0.9 }]),
        );
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            model: 'jev-1.13.0',
            answers,
            usage: { input_tokens: 123, output_tokens: 45 },
          }),
        };
      },
    });

    const result = await provider(request as any);
    expect(body.model).toBe('jev-1.13.0');
    expect(body.state.schema).toBe('anvil.system-one-mapped-state.v0');
    expect(body.state.shared_conversation_state).toEqual(request.shared_conversation_state);
    expect(body.state.candidate_views).toEqual(request.candidate_views);

    const keys = Object.keys(body.questions);
    expect(keys).toEqual([
      'cand-0001.evidence_sufficient',
      'cand-0001.still_needed',
      'cand-0001.full_content_needed',
      'cand-0001.unresolved_evidence',
      'cand-0001.recoverable',
    ]);
    const serializedQuestions = JSON.stringify(body.questions);
    expect(serializedQuestions).not.toContain('preserve evidence');
    expect(serializedQuestions).not.toContain('head');
    expect(serializedQuestions).not.toContain('tail');

    expect(result.mapped_response).toMatchObject({
      schema: 'anvil.mapped-decision-response.v0',
      request_id: 'mdr-system-one',
      observations: [{ candidate_id: 'cand-0001' }],
    });
    expect(result.provider_metadata).toEqual({
      requested_model: 'jev-1.13.0',
      effective_model: 'jev-1.13.0',
      input_tokens: 123,
      output_tokens: 45,
      cost_usd: null,
    });
  });

  it('fails closed on missing, extra, or invalid answer keys', async () => {
    const create = exportedFunction('createSystemOneMappedProvider');
    const request = mappedRequest();

    for (const answers of [
      {},
      {
        'cand-0001.evidence_sufficient': { noul: 0.9 },
        extra: { noul: 0.9 },
      },
      {
        'cand-0001.evidence_sufficient': { noul: 2 },
        'cand-0001.still_needed': { noul: 0.9 },
        'cand-0001.full_content_needed': { noul: 0.9 },
        'cand-0001.unresolved_evidence': { noul: 0.9 },
        'cand-0001.recoverable': { noul: 0.9 },
      },
    ]) {
      const authorize = exportedFunction('authorizeSyntheticFixtureEgress');
      const provider = create({
        apiKey: 'test-key',
        model: 'jev-1.13.0',
        egressGrants: [authorize(request)],
        fetch: async () => ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ model: 'jev-1.13.0', answers }),
        }),
      });
      await expect(provider(request as any)).rejects.toThrow();
    }
  });

  it('denies remote egress when the exact mapped request digest is not granted', async () => {
    const create = exportedFunction('createSystemOneMappedProvider');
    const authorize = exportedFunction('authorizeSyntheticFixtureEgress');
    const request = mappedRequest();
    const changed = { ...request, request_id: 'mdr-not-granted' };
    let calls = 0;

    const provider = create({
      apiKey: 'test-key',
      model: 'jev-1.13.0',
      egressGrants: [authorize(request)],
      fetch: async () => {
        calls += 1;
        throw new Error('transport must remain unreachable');
      },
    });

    await expect(provider(changed as any)).rejects.toThrow(/egress grant/i);
    expect(calls).toBe(0);
  });

  it('refuses to mint synthetic egress grants for non-fixture run identities', () => {
    const authorize = exportedFunction('authorizeSyntheticFixtureEgress');
    const request = mappedRequest();
    request.source_run_id = 'runtime-live-session';
    expect(() => authorize(request)).toThrow(/synthetic fixture/i);
  });

  it('sanitizes HTTP failure text instead of echoing provider bodies', async () => {
    const create = exportedFunction('createSystemOneMappedProvider');
    const request = mappedRequest();
    const authorize = exportedFunction('authorizeSyntheticFixtureEgress');
    const provider = create({
      apiKey: 'test-key',
      model: 'jev-1.13.0',
      egressGrants: [authorize(request)],
      fetch: async () => ({
        ok: false,
        status: 401,
        text: async () => 'secret-token-should-not-escape',
      }),
    });
    await expect(provider(request as any)).rejects.toThrow('System One request failed (401)');
    await expect(provider(request as any)).rejects.not.toThrow(/secret-token/);
  });
});
