import { describe, expect, it } from 'vitest';
import { exportedFunction } from './lab-test-helpers.js';

function trace() {
  return {
    trace_id: 'metric-trace',
    source_run_id: 'run-metric',
    shared_state: '',
    candidates: [{
      candidate_id: 'cand-0001',
      stdout: 'head\ncritical-token\ntail',
      stderr: '',
      exit_status: 0,
      head_lines: 1,
      tail_lines: 1,
      presentation_budget_bytes: 1000,
      recovery: {
        source_digest: 'sha256:' + 'a'.repeat(64),
        recovery_ref: 'cas:x',
        byte_count: 24,
      },
      critical_evidence: ['critical-token'],
    }],
  };
}

describe('replay metrics and scoreboard', () => {
  it('counts omitted critical evidence as false eviction even with a recovery marker', () => {
    const evaluate = exportedFunction('evaluateReplay');
    const metrics = evaluate(trace(), {
      arm: 'B',
      presentations: [{
        candidate_id: 'cand-0001',
        disposition: 'REFERENTIAL',
        visible_text: 'head\ntail\n[sieve-evidence source=x recovery=cas:x omitted_bytes=14]',
        source_digest: 'sha256:' + 'a'.repeat(64),
        omitted_bytes: 14,
        recovery_required: true,
      }],
    });
    expect(metrics.criticalEvidenceFalseEvictions).toBe(1);
    expect(metrics.criticalEvidenceOpportunities).toBe(1);
    expect(metrics.falseEvictionRate).toBe(1);
    expect(metrics.recoveryNeeds).toBe(1);
  });

  it('reports a zero false-eviction rate when every labeled opportunity survives', () => {
    const evaluate = exportedFunction('evaluateReplay');
    const metrics = evaluate(trace(), {
      arm: 'A',
      presentations: [{
        candidate_id: 'cand-0001',
        disposition: 'FULL',
        visible_text: 'head\ncritical-token\ntail',
        source_digest: 'sha256:' + 'a'.repeat(64),
        omitted_bytes: 0,
        recovery_required: false,
      }],
    });
    expect(metrics.criticalEvidenceFalseEvictions).toBe(0);
    expect(metrics.criticalEvidenceOpportunities).toBe(1);
    expect(metrics.falseEvictionRate).toBe(0);
  });

  it('implements approved token economics', () => {
    const evaluate = exportedFunction('evaluateReplay');
    const metrics = evaluate(trace(), { arm: 'D', presentations: [] }, {
      pristineDownstreamTokens: 5000,
      armDownstreamTokensBeforeRehydration: 3000,
      semanticProviderInputTokens: 700,
      semanticProviderOutputTokens: 100,
      recoveryTokens: 200,
    });
    expect(metrics.grossContextTokensSaved).toBe(2000);
    expect(metrics.semanticCostTokens).toBe(800);
    expect(metrics.recoveryCostTokens).toBe(200);
    expect(metrics.netTokenSavings).toBe(1000);
    expect(metrics.jevEfficiencyRatio).toBe(2);
  });

  it('classifies any critical false eviction as architectural failure', () => {
    const classify = exportedFunction('classifyReplay');
    expect(classify({
      criticalEvidenceFalseEvictions: 1,
      semanticCostTokens: 0,
    })).toBe('ARCHITECTURAL_FAILURE');
  });

  it('classifies Jev efficiency below one as architectural failure', () => {
    const classify = exportedFunction('classifyReplay');
    expect(classify({
      criticalEvidenceFalseEvictions: 0,
      semanticCostTokens: 1200,
      jevEfficiencyRatio: 0.8,
    })).toBe('ARCHITECTURAL_FAILURE');
  });
});
