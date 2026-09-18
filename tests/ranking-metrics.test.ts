import { describe, expect, it } from 'vitest';
import {
  areaUnderRocCurve,
  averagePrecisionScore,
} from '../src/lab/ranking-metrics.js';

describe('threshold-free ranking metrics', () => {
  it('reports perfect ranking as AUROC=1 and AUPRC/AP=1', () => {
    const samples = [
      { probability: 0.95, outcome: 1 as const },
      { probability: 0.8, outcome: 1 as const },
      { probability: 0.2, outcome: 0 as const },
      { probability: 0.05, outcome: 0 as const },
    ];
    expect(areaUnderRocCurve(samples)).toBe(1);
    expect(averagePrecisionScore(samples)).toBe(1);
  });

  it('reports reversed ranking without using an arbitrary threshold', () => {
    const samples = [
      { probability: 0.9, outcome: 0 as const },
      { probability: 0.8, outcome: 0 as const },
      { probability: 0.2, outcome: 1 as const },
      { probability: 0.1, outcome: 1 as const },
    ];
    expect(areaUnderRocCurve(samples)).toBe(0);
    expect(averagePrecisionScore(samples)).toBeCloseTo(5 / 12, 12);
  });

  it('handles tied scores without depending on input order', () => {
    const a = [
      { probability: 0.5, outcome: 1 as const },
      { probability: 0.5, outcome: 0 as const },
    ];
    const b = [...a].reverse();
    expect(areaUnderRocCurve(a)).toBe(0.5);
    expect(areaUnderRocCurve(b)).toBe(0.5);
    expect(averagePrecisionScore(a)).toBe(0.5);
    expect(averagePrecisionScore(b)).toBe(0.5);
  });

  it('returns null when the class support cannot define the metric', () => {
    expect(areaUnderRocCurve([
      { probability: 0.9, outcome: 1 },
      { probability: 0.1, outcome: 1 },
    ])).toBeNull();

    expect(averagePrecisionScore([
      { probability: 0.9, outcome: 0 },
      { probability: 0.1, outcome: 0 },
    ])).toBeNull();
  });

  it('rejects invalid probabilities and outcomes', () => {
    expect(() => areaUnderRocCurve([
      { probability: Number.NaN, outcome: 1 },
      { probability: 0.1, outcome: 0 },
    ])).toThrow(/probability/i);
  });
});
