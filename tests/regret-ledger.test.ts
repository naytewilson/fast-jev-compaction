import { describe, expect, it } from 'vitest';
import { CounterfactualRegretLedger } from '../src/lab/regret-ledger.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

function decision(id: string, disposition: 'KEEP_FULL' | 'KEEP_REFERENCE' | 'EVICT_FROM_PRESENTATION') {
  return {
    decisionId: id,
    requestId: 'req-1',
    sourceDigest: d('1'),
    observationDigest: d('2'),
    calibrationIdentity: d('3'),
    authorityIdentity: d('4'),
    disposition,
  } as const;
}

describe('Counterfactual Regret Ledger', () => {
  it('classifies later exact rehydration as false eviction for reduced presentation', () => {
    const ledger = new CounterfactualRegretLedger();
    ledger.recordDecision(decision('d1', 'KEEP_REFERENCE'));
    ledger.recordOutcome({
      decisionId: 'd1',
      outcomeDigest: d('5'),
      verified: true,
      verifierIdentity: 'counterfactual:exact-replay',
      taskSucceeded: true,
      unnecessaryReread: false,
      exactRehydrationRequired: true,
    });

    expect(ledger.classify('d1')).toBe('FALSE_EVICTION');
  });

  it('classifies successful reduced presentation without reread as safe eviction', () => {
    const ledger = new CounterfactualRegretLedger();
    ledger.recordDecision(decision('d1', 'EVICT_FROM_PRESENTATION'));
    ledger.recordOutcome({
      decisionId: 'd1',
      outcomeDigest: d('5'),
      verified: true,
      verifierIdentity: 'deterministic:task-check',
      taskSucceeded: true,
      unnecessaryReread: false,
      exactRehydrationRequired: false,
    });

    expect(ledger.classify('d1')).toBe('SAFE_EVICTION');
  });

  it('keeps unverified outcomes WEAK and non-authoritative', () => {
    const ledger = new CounterfactualRegretLedger();
    ledger.recordDecision(decision('d1', 'KEEP_REFERENCE'));
    ledger.recordOutcome({
      decisionId: 'd1',
      outcomeDigest: d('5'),
      verified: false,
      taskSucceeded: true,
      unnecessaryReread: false,
      exactRehydrationRequired: false,
    });

    expect(ledger.classify('d1')).toBe('UNRESOLVED');
    const labels = ledger.materializeCalibrationLabels();
    expect(labels).toHaveLength(1);
    expect(labels[0].authority).toBe('WEAK');
  });

  it('rejects duplicate decisions and duplicate outcomes', () => {
    const ledger = new CounterfactualRegretLedger();
    ledger.recordDecision(decision('d1', 'KEEP_FULL'));
    expect(() => ledger.recordDecision(decision('d1', 'KEEP_FULL')))
      .toThrow(/duplicate decision/i);

    const outcome = {
      decisionId: 'd1',
      outcomeDigest: d('5'),
      verified: true,
      verifierIdentity: 'deterministic:test',
      taskSucceeded: true,
      unnecessaryReread: false,
      exactRehydrationRequired: false,
    };
    ledger.recordOutcome(outcome);
    expect(() => ledger.recordOutcome(outcome)).toThrow(/duplicate outcome/i);
  });

  it('preserves source identity when materializing a STRONG calibration label', () => {
    const ledger = new CounterfactualRegretLedger();
    ledger.recordDecision(decision('d1', 'KEEP_FULL'));
    ledger.recordOutcome({
      decisionId: 'd1',
      outcomeDigest: d('5'),
      verified: true,
      verifierIdentity: 'human:review-42',
      taskSucceeded: true,
      unnecessaryReread: false,
      exactRehydrationRequired: false,
    });

    const [label] = ledger.materializeCalibrationLabels();
    expect(label.authority).toBe('STRONG');
    expect(label.sourceDigest).toBe(d('1'));
    expect(label.verifierIdentity).toBe('human:review-42');
    expect(label.outcomeDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(label.outcomeDigest).not.toBe(d('5'));
  });
});
