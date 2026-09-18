import { describe, expect, it } from 'vitest';
import * as library from '../src/index.js';

type AnyFn = (...args: any[]) => any;

function exportedFunction(name: string): AnyFn {
  const value = (library as Record<string, unknown>)[name];
  expect(typeof value).toBe('function');
  return value as AnyFn;
}

const digest = (char: string) => `sha256:${char.repeat(64)}`;

function candidate(id = 'cand-0001') {
  return {
    candidate_id: id,
    source_digest: digest('a'),
    source_kind: 'tool_result',
    recovery_ref: 'cas:object-0001',
    byte_count: 1234,
    hard_roots: {
      exit_status: 0,
      stderr: [],
      first_lines: ['build started'],
      last_lines: ['build complete'],
    },
    semantic_view: {
      head: 'build started',
      tail: 'build complete',
      selected_chunks: [],
      omitted_bytes: 900,
    },
  };
}

function validRequest() {
  return {
    schema: 'anvil.mapped-decision-request.v0',
    request_id: 'mdr-0001',
    source_run_id: 'run-0001',
    decision_contract: {
      id: 'anvil.context-retention.v1',
      version: '0.1.0',
      digest: digest('b'),
    },
    execution_profile: {
      id: 'typesafe-systemone-jev',
      version: '0.1.0',
      digest: digest('c'),
    },
    calibration_profile: {
      id: 'anvil.context-retention.jev-shadow',
      version: '0.1.0',
      digest: digest('d'),
    },
    policy_profile: {
      id: 'anvil.context-retention.shadow-policy',
      version: '0.1.0',
      digest: digest('e'),
    },
    shared_conversation_state: {
      mission: 'preserve critical evidence',
      recent_turns: ['run the build'],
      active_constraints: ['do not drop failures'],
      unresolved_failures: [],
      source_refs: [digest('f')],
    },
    candidate_views: [candidate()],
  };
}

describe('MappedDecisionContract request validation', () => {
  it('accepts a structurally exact provider-neutral request', () => {
    const validate = exportedFunction('validateMappedDecisionRequest');
    expect(validate(validRequest())).toEqual({ ok: true });
  });

  it('rejects zero candidates', () => {
    const validate = exportedFunction('validateMappedDecisionRequest');
    const request = validRequest();
    request.candidate_views = [];
    expect(validate(request)).toMatchObject({ ok: false });
  });

  it('rejects more than 64 candidates', () => {
    const validate = exportedFunction('validateMappedDecisionRequest');
    const request = validRequest();
    request.candidate_views = Array.from({ length: 65 }, (_, i) =>
      candidate(`cand-${String(i + 1).padStart(4, '0')}`),
    );
    expect(validate(request)).toMatchObject({ ok: false });
  });

  it('rejects duplicate candidate ids', () => {
    const validate = exportedFunction('validateMappedDecisionRequest');
    const request = validRequest();
    request.candidate_views = [candidate('cand-0001'), candidate('cand-0001')];
    expect(validate(request)).toMatchObject({ ok: false });
  });

  it('rejects malformed source digests', () => {
    const validate = exportedFunction('validateMappedDecisionRequest');
    const request = validRequest();
    request.candidate_views[0]!.source_digest = 'sha256:not-a-digest';
    expect(validate(request)).toMatchObject({ ok: false });
  });

  it('requires a CAS recovery reference for every V0 candidate', () => {
    const validate = exportedFunction('validateMappedDecisionRequest');
    const request = validRequest() as any;
    delete request.candidate_views[0].recovery_ref;
    expect(validate(request)).toMatchObject({ ok: false });
  });

  it('rejects non-deterministic candidate order', () => {
    const validate = exportedFunction('validateMappedDecisionRequest');
    const request = validRequest();
    request.candidate_views = [candidate('cand-0002'), candidate('cand-0001')];
    expect(validate(request)).toMatchObject({ ok: false });
  });

  it('rejects unexpected candidate fields', () => {
    const validate = exportedFunction('validateMappedDecisionRequest');
    const request = validRequest() as any;
    request.candidate_views[0].authority = 'caller-claimed';
    expect(validate(request)).toMatchObject({ ok: false });
  });

  it('rejects unexpected top-level fields', () => {
    const validate = exportedFunction('validateMappedDecisionRequest');
    const request = validRequest() as any;
    request.provider_url = 'https://example.invalid';
    expect(validate(request)).toMatchObject({ ok: false });
  });
});
