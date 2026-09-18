import { describe, expect, it } from 'vitest';
import { exportedFunction, exportedValue } from './lab-test-helpers.js';

function conservativeProvider(request: any) {
  return {
    schema: 'anvil.mapped-decision-response.v0',
    request_id: request.request_id,
    observations: request.candidate_views.map((candidate: any) => ({
      candidate_id: candidate.candidate_id,
      evidence_sufficient: { noul: 0.95 },
      still_needed: { noul: 0.9 },
      full_content_needed: { noul: 0.95 },
      unresolved_evidence: { noul: 0.95 },
      recoverable: { noul: 0.99 },
    })),
  };
}

describe('offline replay matrix', () => {
  it('runs A/B/C/D over the dependency corpus without mutating CAS', async () => {
    const corpus = exportedFunction('dependencyTrapCorpus')();
    const runMatrix = exportedFunction('runReplayMatrix');
    const CAS = exportedValue('InMemoryCAS');
    const cas = new CAS();

    for (const trace of corpus) {
      for (const candidate of trace.candidates) {
        const objectID = candidate.recovery.recovery_ref.slice(4);
        if (trace.trace_id === 'trap-recovery-mismatch') {
          cas.put(objectID, candidate.stdout + '-tampered');
        } else {
          cas.put(objectID, candidate.stdout);
        }
      }
    }

    const before = cas.snapshotDigest();
    const report = await runMatrix(corpus, {
      cas,
      upstreamObserver: async () => ({ keepCall: 0.1, keepResult: 0.1 }),
      observationProvider: conservativeProvider,
    });
    const after = cas.snapshotDigest();

    expect(before).toBe(after);
    expect(report.arms.A.criticalEvidenceFalseEvictions).toBe(0);
    expect(report.arms.B.criticalEvidenceFalseEvictions).toBeGreaterThan(0);
    expect(report.arms.C.criticalEvidenceFalseEvictions).toBeGreaterThan(0);
    expect(report.arms.D.criticalEvidenceFalseEvictions).toBe(0);
    expect(report.arms.C.classification).toBe('ARCHITECTURAL_FAILURE');
    expect(report.traceCount).toBe(corpus.length);
  });
});
