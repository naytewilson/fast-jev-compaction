import { describe, expect, it } from 'vitest';
import {
  brierScore,
  expectedCalibrationError,
  falseAuthorityMetrics,
  negativeLogLikelihood,
  selectiveRiskCoverage,
  thresholdLocalCalibrationError,
} from '../src/lab/calibration-metrics.js';

describe('calibration metrics', () => {
  const samples = [
    { probability: 0.1, outcome: 0 as const },
    { probability: 0.9, outcome: 1 as const },
  ];

  it('computes hand-checkable ECE and Brier score', () => {
    expect(expectedCalibrationError(samples, 2)).toBeCloseTo(0.1, 12);
    expect(brierScore(samples)).toBeCloseTo(0.01, 12);
  });

  it('computes finite NLL and threshold-local calibration error', () => {
    expect(negativeLogLikelihood(samples)).toBeCloseTo(-Math.log(0.9), 12);
    expect(thresholdLocalCalibrationError([
      { probability: 0.45, outcome: 0 },
      { probability: 0.55, outcome: 1 },
      { probability: 0.9, outcome: 1 },
    ], 0.5, 0.1)).toBeCloseTo(0.45, 12);
  });

  it('computes selected risk and coverage without hiding zero-selection cases', () => {
    expect(selectiveRiskCoverage([
      { probability: 0.9, outcome: 1, selected: true },
      { probability: 0.8, outcome: 0, selected: true },
      { probability: 0.2, outcome: 0, selected: false },
      { probability: 0.1, outcome: 0, selected: false },
    ])).toEqual({
      total: 4,
      selected: 2,
      coverage: 0.5,
      errors: 1,
      risk: 0.5,
    });
  });

  it('reports zero observed leaks without claiming true zero risk', () => {
    const records = Array.from({ length: 10_000 }, () => ({
      shouldHavePolicyAuthority: false,
      policyTriggered: false,
    }));
    const result = falseAuthorityMetrics(records);

    expect(result.opportunities).toBe(10_000);
    expect(result.leaks).toBe(0);
    expect(result.fasr).toBe(1);
    expect(result.approximateFarUpper95).toBeCloseTo(0.0003, 12);
  });

  it('reports nonzero leak risk and leaves no-opportunity trials unscored', () => {
    const oneLeak = falseAuthorityMetrics([
      { shouldHavePolicyAuthority: false, policyTriggered: true },
      { shouldHavePolicyAuthority: false, policyTriggered: false },
    ]);
    expect(oneLeak.leaks).toBe(1);
    expect(oneLeak.fasr).toBe(0.5);
    expect(oneLeak.approximateFarUpper95).toBeNull();

    const none = falseAuthorityMetrics([
      { shouldHavePolicyAuthority: true, policyTriggered: true },
    ]);
    expect(none.opportunities).toBe(0);
    expect(none.fasr).toBeNull();
    expect(none.approximateFarUpper95).toBeNull();
  });

  it('rejects invalid probability domains', () => {
    expect(() => brierScore([{ probability: Number.NaN, outcome: 1 }]))
      .toThrow(/probability/i);
    expect(() => expectedCalibrationError([{ probability: 1.1, outcome: 1 }], 10))
      .toThrow(/probability/i);
  });
});
