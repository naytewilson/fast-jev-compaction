import { describe, expect, it } from 'vitest';
import { evaluateDegradedTrial } from '../src/lab/degraded-trial.js';

function cycle(overrides: Partial<Parameters<typeof evaluateDegradedTrial>[0][number]> = {}) {
  return {
    scenario: 'PARTIAL' as const,
    shouldHavePolicyAuthority: false,
    policyTriggered: false,
    taskCompleted: true,
    fallbackActivated: true,
    detectMs: 0.3,
    routeMs: 0.4,
    firstUsefulResultMs: 4,
    fallbackCompleteMs: 12,
    calibrationProbability: 0.2,
    calibrationOutcome: 0 as const,
    syntheticTiming: true,
    ...overrides,
  };
}

describe('Degraded Evidence / Self-Healing Trial', () => {
  it('passes a synthetic mixed scenario matrix with zero false-authority leaks', () => {
    const result = evaluateDegradedTrial([
      cycle({ scenario: 'FULL', shouldHavePolicyAuthority: true, policyTriggered: true, fallbackActivated: false }),
      cycle({ scenario: 'PARTIAL' }),
      cycle({ scenario: 'MODEL_BUMP', calibrationProbability: 0.1 }),
    ]);

    expect(result.verdict).toBe('PASS_SYNTHETIC');
    expect(result.falseAuthority.leaks).toBe(0);
    expect(result.scenarioCounts.FULL).toBe(1);
    expect(result.scenarioCounts.PARTIAL).toBe(1);
    expect(result.scenarioCounts.MODEL_BUMP).toBe(1);
    expect(result.timingEvidence).toBe('synthetic');
  });

  it('fails architecture on any invalid-lane policy trigger', () => {
    const result = evaluateDegradedTrial([
      cycle({ scenario: 'ABSENT', policyTriggered: true }),
    ]);
    expect(result.verdict).toBe('ARCHITECTURAL_FAILURE');
    expect(result.falseAuthority.leaks).toBe(1);
  });

  it('distinguishes measured-only timing evidence', () => {
    const result = evaluateDegradedTrial([
      cycle({ scenario: 'QUANTIZATION_SHIFT', syntheticTiming: false }),
      cycle({ scenario: 'NORMALIZER_SHIFT', syntheticTiming: false }),
    ]);
    expect(result.verdict).toBe('PASS_MEASURED');
    expect(result.timingEvidence).toBe('measured');
  });

  it('computes route p99 from supplied timing records instead of hard-coding an SLA', () => {
    const result = evaluateDegradedTrial([
      cycle({ detectMs: 0.1, routeMs: 0.1 }),
      cycle({ detectMs: 0.2, routeMs: 0.2 }),
      cycle({ detectMs: 1.0, routeMs: 2.0 }),
    ]);
    expect(result.routeLatencyMs.p99).toBe(3);
  });

  it('reports stable scenario counts and fallback coverage retention', () => {
    const result = evaluateDegradedTrial([
      cycle({ scenario: 'PARTIAL', taskCompleted: true }),
      cycle({ scenario: 'PARTIAL', taskCompleted: false }),
      cycle({ scenario: 'CANARY_REGRESSION', taskCompleted: true }),
    ]);
    expect(result.scenarioCounts.PARTIAL).toBe(2);
    expect(result.scenarioCounts.CANARY_REGRESSION).toBe(1);
    expect(result.fallbackCoverageRetention).toBeCloseTo(2 / 3, 12);
  });

  it('is UNSCORED when there are no no-authority opportunities', () => {
    const result = evaluateDegradedTrial([
      cycle({
        scenario: 'FULL',
        shouldHavePolicyAuthority: true,
        policyTriggered: true,
        fallbackActivated: false,
      }),
    ]);
    expect(result.verdict).toBe('UNSCORED');
    expect(result.falseAuthority.opportunities).toBe(0);
  });
});
