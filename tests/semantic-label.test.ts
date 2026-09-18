import { describe, expect, it } from 'vitest';
import {
  selectAuthoritativeSemanticLabels,
  validateSemanticCalibrationLabel,
} from '../src/lab/semantic-label.js';
import { CounterfactualRegretLedger } from '../src/lab/regret-ledger.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

const context = {
  decisionContractDigest: d('a'),
  labelBindingDigest: d('b'),
};

function recordReduced(
  ledger: CounterfactualRegretLedger,
  decisionId: string,
  exactRehydrationRequired: boolean,
) {
  ledger.recordDecision({
    decisionId,
    requestId: 'req-1',
    sourceDigest: d('1'),
    observationDigest: d('2'),
    calibrationIdentity: d('3'),
    authorityIdentity: d('4'),
    disposition: exactRehydrationRequired ? 'KEEP_REFERENCE' : 'EVICT_FROM_PRESENTATION',
  });
  ledger.recordOutcome({
    decisionId,
    outcomeDigest: d('5'),
    verified: true,
    verifierIdentity: 'counterfactual:exact',
    taskSucceeded: true,
    unnecessaryReread: false,
    exactRehydrationRequired,
  });
}

describe('typed semantic calibration labels', () => {
  it('maps verified FALSE_EVICTION to still_needed target=1', () => {
    const ledger = new CounterfactualRegretLedger();
    recordReduced(ledger, 'false-eviction', true);

    const labels = ledger.materializeStillNeededLabels(context);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({
      authority: 'STRONG',
      decisionContractDigest: d('a'),
      predicateId: 'still_needed',
      labelBindingDigest: d('b'),
      sourceDigest: d('1'),
      target: 1,
      verifierIdentity: 'counterfactual:exact',
    });
  });

  it('maps verified SAFE_EVICTION to still_needed target=0', () => {
    const ledger = new CounterfactualRegretLedger();
    recordReduced(ledger, 'safe-eviction', false);

    const [label] = ledger.materializeStillNeededLabels(context);
    expect(label.target).toBe(0);
    expect(label.authority).toBe('STRONG');
  });

  it('does not invent counterfactual still-needed labels from safe full retention', () => {
    const ledger = new CounterfactualRegretLedger();
    ledger.recordDecision({
      decisionId: 'keep',
      requestId: 'req-1',
      sourceDigest: d('1'),
      observationDigest: d('2'),
      calibrationIdentity: d('3'),
      authorityIdentity: d('4'),
      disposition: 'KEEP_FULL',
    });
    ledger.recordOutcome({
      decisionId: 'keep',
      outcomeDigest: d('5'),
      verified: true,
      verifierIdentity: 'deterministic:task',
      taskSucceeded: true,
      unnecessaryReread: false,
      exactRehydrationRequired: false,
    });

    expect(ledger.materializeStillNeededLabels(context)).toEqual([]);
  });

  it('requires verifier identity for STRONG semantic labels and filters WEAK labels', () => {
    const strong = {
      labelId: 'a',
      authority: 'STRONG' as const,
      decisionContractDigest: d('1'),
      predicateId: 'still_needed' as const,
      labelBindingDigest: d('2'),
      sourceDigest: d('3'),
      outcomeDigest: d('4'),
      target: 1 as const,
      verifierIdentity: 'human:review',
    };
    const weak = {
      ...strong,
      labelId: 'b',
      authority: 'WEAK' as const,
      verifierIdentity: undefined,
    };

    expect(validateSemanticCalibrationLabel(strong)).toBe(true);
    expect(selectAuthoritativeSemanticLabels([weak, strong]).map((label) => label.labelId))
      .toEqual(['a']);

    expect(() => validateSemanticCalibrationLabel({
      ...strong,
      verifierIdentity: undefined,
    })).toThrow(/verifier/i);
  });

  it('rejects duplicate label ids before authoritative fitting', () => {
    const label = {
      labelId: 'dup',
      authority: 'STRONG' as const,
      decisionContractDigest: d('1'),
      predicateId: 'still_needed' as const,
      labelBindingDigest: d('2'),
      sourceDigest: d('3'),
      outcomeDigest: d('4'),
      target: 1 as const,
      verifierIdentity: 'deterministic:test',
    };
    expect(() => selectAuthoritativeSemanticLabels([label, { ...label }]))
      .toThrow(/duplicate label/i);
  });
});
