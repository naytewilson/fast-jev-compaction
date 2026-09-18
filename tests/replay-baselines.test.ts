import { describe, expect, it } from 'vitest';
import { exportedFunction, exportedValue } from './lab-test-helpers.js';

function traceWith(source: string, critical = 'needle') {
  const create = exportedFunction('createToolRecoveryManifest');
  return {
    trace_id: 'trace-1',
    source_run_id: 'run-1',
    shared_state: 'fix the build',
    candidates: [{
      candidate_id: 'cand-0001',
      stdout: source,
      stderr: '',
      exit_status: 0,
      head_lines: 1,
      tail_lines: 1,
      presentation_budget_bytes: 1000,
      recovery: create(source, '', 0, 'trace-1-cand-1'),
      critical_evidence: [critical],
    }],
  };
}

describe('replay baselines', () => {
  it('Arm A presents pristine evidence', () => {
    const CAS = exportedValue('InMemoryCAS');
    const arm = exportedFunction('runPristineArm');
    const trace = traceWith('head\nneedle\ntail');
    const cas = new CAS();
    const encode = exportedFunction('encodeToolEvidence');
    cas.put(
      'trace-1-cand-1',
      encode(trace.candidates[0].stdout, trace.candidates[0].stderr, trace.candidates[0].exit_status),
    );
    const run = arm(trace, cas);
    expect(run.presentations[0]).toMatchObject({ disposition: 'FULL' });
    expect(run.presentations[0].visible_text).toContain('needle');
  });

  it('Arm B emits a CAS-bound referential marker when exact recovery exists', () => {
    const CAS = exportedValue('InMemoryCAS');
    const arm = exportedFunction('runDeterministicArm');
    const trace = traceWith('head\nneedle\ntail');
    const cas = new CAS();
    const encode = exportedFunction('encodeToolEvidence');
    cas.put(
      'trace-1-cand-1',
      encode(trace.candidates[0].stdout, trace.candidates[0].stderr, trace.candidates[0].exit_status),
    );
    const run = arm(trace, cas);
    expect(run.presentations[0].disposition).toBe('REFERENTIAL');
    expect(run.presentations[0].visible_text).toContain('[sieve-evidence source=sha256:');
    expect(run.presentations[0].visible_text).toContain('recovery=cas:trace-1-cand-1');
  });

  it('Arm B refuses referential compression when candidate stderr no longer matches the bound evidence', () => {
    const CAS = exportedValue('InMemoryCAS');
    const arm = exportedFunction('runDeterministicArm');
    const encode = exportedFunction('encodeToolEvidence');
    const trace = traceWith('head\nneedle\ntail');
    const cas = new CAS();
    cas.put(
      'trace-1-cand-1',
      encode(trace.candidates[0].stdout, trace.candidates[0].stderr, trace.candidates[0].exit_status),
    );
    trace.candidates[0].stderr = 'late unbound warning';
    const run = arm(trace, cas);
    expect(run.presentations[0]).toMatchObject({ disposition: 'FULL' });
  });

  it('Arm B keeps full content if exact recovery is unavailable', () => {
    const CAS = exportedValue('InMemoryCAS');
    const arm = exportedFunction('runDeterministicArm');
    const trace = traceWith('head\nneedle\ntail');
    const run = arm(trace, new CAS());
    expect(run.presentations[0]).toMatchObject({
      disposition: 'FULL',
      recovery_required: false,
    });
    expect(run.presentations[0].visible_text).toContain('needle');
  });

  it('ships all required dependency traps', () => {
    const corpus = exportedFunction('dependencyTrapCorpus')();
    const names = corpus.map((item: any) => item.trace_id);
    expect(names).toEqual(expect.arrayContaining([
      'trap-deprecation-middle',
      'trap-memory-address-middle',
      'trap-stderr-warning',
      'trap-original-failure',
      'trap-changed-path',
      'trap-provenance-only',
      'trap-insufficient-view',
      'trap-recovery-mismatch',
    ]));
  });

  it('uses realistic long synthetic fixtures with critical evidence away from head/tail roots', () => {
    const corpus = exportedFunction('dependencyTrapCorpus')();
    expect(corpus).toHaveLength(8);

    for (const trace of corpus) {
      expect(trace.source_run_id).toMatch(/^fixture-/);
      const candidate = trace.candidates[0];
      expect(Buffer.byteLength(candidate.stdout, 'utf8')).toBeGreaterThan(8_000);

      const lines = candidate.stdout.split('\n');
      expect(lines.length).toBeGreaterThan(250);
      const rootText = [
        ...lines.slice(0, candidate.head_lines),
        ...lines.slice(-candidate.tail_lines),
      ].join('\n');

      for (const critical of candidate.critical_evidence) {
        if (candidate.stderr.includes(critical)) continue;
        expect(candidate.stdout).toContain(critical);
        expect(rootText).not.toContain(critical);
      }
    }
  });
});
