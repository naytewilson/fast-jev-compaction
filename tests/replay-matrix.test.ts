import { describe, expect, it } from 'vitest';
import { exportedFunction, exportedValue } from './lab-test-helpers.js';

function conservativeProvider(request: any) {
  return {
    schema: 'anvil.mapped-decision-response.v1',
    request_id: request.request_id,
    observations: request.candidate_views.map((candidate: any) => ({
      candidate_id: candidate.candidate_id,
      evidence_sufficient: { noul: 0.95 },
      still_needed: { noul: 0.9 },
      full_content_needed: { noul: 0.95 },
      unresolved_evidence: { noul: 0.95 },
    })),
  };
}

describe('offline replay matrix', () => {
  it('runs A/B/C/D over the dependency corpus without mutating CAS', async () => {
    const corpus = exportedFunction('dependencyTrapCorpus')();
    const runMatrix = exportedFunction('runReplayMatrix');
    const CAS = exportedValue('InMemoryCAS');
    const cas = new CAS();
    const encode = exportedFunction('encodeToolEvidence');

    for (const trace of corpus) {
      for (const candidate of trace.candidates) {
        const objectID = candidate.recovery.recovery_ref.slice(4);
        if (trace.trace_id === 'trap-recovery-mismatch') {
          cas.put(
            objectID,
            encode(candidate.stdout, candidate.stderr, candidate.exit_status) + '-tampered',
          );
        } else {
          cas.put(
            objectID,
            encode(candidate.stdout, candidate.stderr, candidate.exit_status),
          );
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
    for (const arm of ['A', 'B', 'C', 'D']) {
      expect(report.arms[arm].sourceBytes).toBeGreaterThan(0);
      expect(report.arms[arm].visibleBytes).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(report.arms[arm].visibleBytes)).toBe(true);
    }
    expect(report.arms.A.visibleBytes).toBe(report.arms.A.sourceBytes);
    expect(report.arms.D.receiptCount).toBe(corpus.length);
  });
});

function loadCorpusIntoCas(cas: any, corpus: any[]) {
  const encode = exportedFunction('encodeToolEvidence');
  for (const trace of corpus) {
    for (const candidate of trace.candidates) {
      const objectID = candidate.recovery.recovery_ref.slice(4);
      const stored = encode(candidate.stdout, candidate.stderr, candidate.exit_status);
      cas.put(
        objectID,
        trace.trace_id === 'trap-recovery-mismatch' ? `${stored}-tampered` : stored,
      );
    }
  }
}

function matrixDependencies(cas: any, observationProvider: any) {
  return {
    cas,
    upstreamObserver: async () => ({ keepCall: 0.1, keepResult: 0.1 }),
    observationProvider,
  };
}

function abstainingProvider(request: any) {
  return {
    schema: 'anvil.mapped-decision-response.v1',
    request_id: request.request_id,
    observations: request.candidate_views.map((candidate: any) => ({
      candidate_id: candidate.candidate_id,
      evidence_sufficient: { noul: 0.2 },
      still_needed: { noul: 0.9 },
      full_content_needed: { noul: 0.95 },
      unresolved_evidence: { noul: 0.95 },
    })),
  };
}

function envelopeProvider(request: any) {
  return {
    mapped_response: conservativeProvider(request),
    provider_metadata: {
      requested_model: 'jev-1.13.0',
      effective_model: 'jev-1.13.0',
      input_tokens: 700,
      output_tokens: 100,
      cost_usd: null,
    },
  };
}

describe('replay matrix scoreboard invariants', () => {
  it('reports false-eviction count and rate over labeled opportunities', async () => {
    const corpus = exportedFunction('dependencyTrapCorpus')();
    const CAS = exportedValue('InMemoryCAS');
    const cas = new CAS();
    loadCorpusIntoCas(cas, corpus);
    const runMatrix = exportedFunction('runReplayMatrix');
    const report = await runMatrix(corpus, matrixDependencies(cas, conservativeProvider));

    expect(report.candidateCount).toBe(corpus.length);
    expect(report.arms.A.criticalEvidenceOpportunities).toBe(corpus.length);
    expect(report.arms.A.falseEvictionRate).toBe(0);
    expect(report.arms.B.falseEvictionRate).toBeGreaterThan(0);
    expect(report.arms.C.falseEvictionRate).toBeGreaterThan(0);
    expect(report.arms.D.falseEvictionRate).toBe(0);
    for (const arm of ['B', 'C']) {
      expect(report.arms[arm].falseEvictionRate).toBeCloseTo(
        report.arms[arm].criticalEvidenceFalseEvictions /
          report.arms[arm].criticalEvidenceOpportunities,
        10,
      );
    }
  });

  it('measures exact rehydration attempts and successes per arm', async () => {
    const corpus = exportedFunction('dependencyTrapCorpus')();
    const CAS = exportedValue('InMemoryCAS');
    const cas = new CAS();
    loadCorpusIntoCas(cas, corpus);
    const runMatrix = exportedFunction('runReplayMatrix');
    const report = await runMatrix(corpus, matrixDependencies(cas, conservativeProvider));

    for (const arm of ['A', 'B', 'C', 'D']) {
      expect(report.arms[arm].recoveryAttempts).toBe(report.arms[arm].recoveryNeeds);
    }
    expect(report.arms.B.recoveryAttempts).toBeGreaterThan(0);
    expect(report.arms.C.recoveryAttempts).toBeGreaterThan(0);
    for (const arm of ['A', 'B', 'C', 'D']) {
      const aggregate = report.arms[arm];
      expect(aggregate.exactRecoverySuccesses).toBeGreaterThanOrEqual(0);
      expect(aggregate.exactRecoveryFailures).toBeGreaterThanOrEqual(0);
      expect(aggregate.exactRecoverySuccesses + aggregate.exactRecoveryFailures)
        .toBe(aggregate.recoveryAttempts);
      if (aggregate.recoveryAttempts > 0) {
        expect(aggregate.exactRecoverySuccessRate)
          .toBeCloseTo(aggregate.exactRecoverySuccesses / aggregate.recoveryAttempts, 10);
      }
    }
  });

  it('counts a failed rehydration against the arm that required it', () => {
    const measure = exportedFunction('measureExactRehydration');
    const CAS = exportedValue('InMemoryCAS');
    const cas = new CAS();
    const outcome = measure(
      {
        trace_id: 'rehydration-fail',
        source_run_id: 'run-rehydration-fail',
        shared_state: '',
        candidates: [{
          candidate_id: 'cand-0001',
          stdout: 'head\ncritical\ntail',
          stderr: '',
          exit_status: 0,
          head_lines: 1,
          tail_lines: 1,
          presentation_budget_bytes: 10,
          recovery: {
            source_digest: 'sha256:' + 'f'.repeat(64),
            recovery_ref: 'cas:missing-object',
            byte_count: 19,
          },
          critical_evidence: [],
        }],
      },
      {
        arm: 'D',
        presentations: [{
          candidate_id: 'cand-0001',
          disposition: 'REFERENTIAL',
          visible_text: 'head\ntail\n[sieve-evidence]',
          source_digest: 'sha256:' + 'f'.repeat(64),
          omitted_bytes: 8,
          recovery_required: true,
        }],
      },
      cas,
    );
    expect(outcome.recoveryAttempts).toBe(1);
    expect(outcome.exactRecoverySuccesses).toBe(0);
    expect(outcome.exactRecoveryFailures).toBe(1);
  });

  it('aggregates semantic provider tokens and computes economics when downstream costs are supplied', async () => {
    const corpus = exportedFunction('dependencyTrapCorpus')();
    const CAS = exportedValue('InMemoryCAS');
    const cas = new CAS();
    loadCorpusIntoCas(cas, corpus);
    const runMatrix = exportedFunction('runReplayMatrix');
    const report = await runMatrix(corpus, {
      ...matrixDependencies(cas, envelopeProvider),
      downstreamTokens: () => ({ pristine: 5000, arm: 3000, recovery: 0 }),
    });

    const d = report.arms.D;
    expect(d.semanticProviderInputTokens).toBe(700 * corpus.length);
    expect(d.semanticProviderOutputTokens).toBe(100 * corpus.length);
    expect(d.semanticCostTokens).toBe(800 * corpus.length);
    expect(d.grossContextTokensSaved).toBe(2000 * corpus.length);
    expect(d.netTokenSavings).toBe((2000 - 800) * corpus.length);
    expect(d.jevEfficiencyRatio).toBeCloseTo(2000 / 800, 5);
    expect(d.classification).toBe('PASS');
  });

  it('classifies semantic cost below gross savings as an architectural economics failure', async () => {
    const corpus = exportedFunction('dependencyTrapCorpus')();
    const CAS = exportedValue('InMemoryCAS');
    const cas = new CAS();
    loadCorpusIntoCas(cas, corpus);
    const runMatrix = exportedFunction('runReplayMatrix');
    const report = await runMatrix(corpus, {
      ...matrixDependencies(cas, envelopeProvider),
      downstreamTokens: () => ({ pristine: 1000, arm: 500, recovery: 0 }),
    });
    const d = report.arms.D;
    expect(d.semanticCostTokens).toBe(800 * corpus.length);
    expect(d.jevEfficiencyRatio).toBeCloseTo(500 / 800, 5);
    expect(d.classification).toBe('ARCHITECTURAL_FAILURE');
  });

  it('leaves economics UNSCORED when semantic cost exists but downstream tokens are unmeasured', async () => {
    const corpus = exportedFunction('dependencyTrapCorpus')();
    const CAS = exportedValue('InMemoryCAS');
    const cas = new CAS();
    loadCorpusIntoCas(cas, corpus);
    const runMatrix = exportedFunction('runReplayMatrix');
    const report = await runMatrix(corpus, matrixDependencies(cas, envelopeProvider));
    const d = report.arms.D;
    expect(d.semanticCostTokens).toBe(800 * corpus.length);
    expect(d.grossContextTokensSaved).toBeUndefined();
    expect(d.jevEfficiencyRatio).toBeUndefined();
    expect(d.classification).toBe('UNSCORED');
  });

  it('emits ABSTAIN dispositions under the sufficiency floor and reports the abstention rate', async () => {
    const corpus = exportedFunction('dependencyTrapCorpus')();
    const CAS = exportedValue('InMemoryCAS');
    const cas = new CAS();
    loadCorpusIntoCas(cas, corpus);
    const runMatrix = exportedFunction('runReplayMatrix');
    const report = await runMatrix(corpus, matrixDependencies(cas, abstainingProvider));
    const d = report.arms.D;
    expect(d.abstentions).toBe(corpus.length);
    expect(d.abstentionRate).toBe(1);
    expect(d.criticalEvidenceFalseEvictions).toBe(0);
  });

  it('aggregates pristine-fallback rate and provider latency from Arm D receipts', async () => {
    const corpus = exportedFunction('dependencyTrapCorpus')();
    const CAS = exportedValue('InMemoryCAS');
    const cas = new CAS();
    loadCorpusIntoCas(cas, corpus);
    const runMatrix = exportedFunction('runReplayMatrix');
    const flakyProvider = (request: any) => {
      if (request.request_id === 'mdr-trap-deprecation-middle') {
        throw new Error('simulated provider failure');
      }
      return envelopeProvider(request);
    };
    const report = await runMatrix(corpus, matrixDependencies(cas, flakyProvider));
    const d = report.arms.D;
    expect(d.pristineFallbacks).toBe(1);
    expect(d.pristineFallbackRate).toBeCloseTo(1 / corpus.length, 10);
    expect(Number.isFinite(d.latencyMsTotal)).toBe(true);
    expect(d.latencyMsTotal).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(d.latencyMsMean)).toBe(true);
  });
});
