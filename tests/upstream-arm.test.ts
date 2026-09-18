import { describe, expect, it } from 'vitest';
import { exportedFunction, exportedValue } from './lab-test-helpers.js';

function makeTrace() {
  const create = exportedFunction('createToolRecoveryManifest');
  const stdout = 'head\nCRITICAL-MIDDLE\ntail';
  return {
    trace_id: 'upstream-trace',
    source_run_id: 'run-upstream',
    shared_state: 'later task depends on evidence',
    candidates: [{
      candidate_id: 'cand-0001',
      stdout,
      stderr: '',
      exit_status: 0,
      head_lines: 1,
      tail_lines: 1,
      presentation_budget_bytes: 1000,
      recovery: create(stdout, '', 0, 'upstream-cand-1'),
      critical_evidence: ['CRITICAL-MIDDLE'],
    }],
  };
}

describe('upstream semantics comparator', () => {
  it('can false-evict unseen middle evidence under low scores', async () => {
    const CAS = exportedValue('InMemoryCAS');
    const run = exportedFunction('runUpstreamComparator');
    const evaluate = exportedFunction('evaluateReplay');
    const trace = makeTrace();
    const cas = new CAS();
    const encode = exportedFunction('encodeToolEvidence');
    cas.put(
      'upstream-cand-1',
      encode(trace.candidates[0].stdout, trace.candidates[0].stderr, trace.candidates[0].exit_status),
    );

    const seenStates: any[] = [];
    const observer = async (state: unknown) => {
      seenStates.push(state);
      return { keepCall: 0.1, keepResult: 0.1 };
    };

    const result = await run(trace, cas, observer, 0.5);
    expect(JSON.stringify(seenStates)).not.toContain('CRITICAL-MIDDLE');
    expect(evaluate(trace, result).criticalEvidenceFalseEvictions).toBe(1);
    expect(cas.verify(trace.candidates[0].recovery)).toEqual({ ok: true });
  });

  it('returns full content on observer failure', async () => {
    const CAS = exportedValue('InMemoryCAS');
    const run = exportedFunction('runUpstreamComparator');
    const trace = makeTrace();
    const cas = new CAS();
    const encode = exportedFunction('encodeToolEvidence');
    cas.put(
      'upstream-cand-1',
      encode(trace.candidates[0].stdout, trace.candidates[0].stderr, trace.candidates[0].exit_status),
    );
    const result = await run(trace, cas, async () => {
      throw new Error('provider unavailable');
    }, 0.5);
    expect(result.presentations[0]).toMatchObject({ disposition: 'FULL' });
    expect(result.presentations[0].visible_text).toContain('CRITICAL-MIDDLE');
  });
});
