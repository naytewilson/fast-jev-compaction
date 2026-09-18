import { describe, expect, it } from 'vitest';
import {
  applyIsotonicCalibration,
  fitIsotonicCalibration,
} from '../src/lab/isotonic-calibrator.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

function sample(
  labelId: string,
  probability: number,
  target: 0 | 1,
  profile = d('1'),
  predicate = 'still_needed' as const,
) {
  return {
    labelId,
    sourceDigest: d(labelId === 'a' ? '2' : labelId === 'b' ? '3' : labelId === 'c' ? '4' : '5'),
    predicateId: predicate,
    executionProfileDigest: profile,
    observationDigest: d(labelId === 'a' ? '6' : labelId === 'b' ? '7' : labelId === 'c' ? '8' : '9'),
    probability,
    target,
  };
}

describe('deterministic isotonic calibration', () => {
  const violating = [
    sample('a', 0.1, 0),
    sample('b', 0.2, 1),
    sample('c', 0.3, 0),
    sample('d', 0.4, 1),
  ];

  it('pools adjacent violations and emits a monotone piecewise model', () => {
    const model = fitIsotonicCalibration(violating);
    const ys = model.blocks.map((block) => block.calibratedProbability);

    expect(model.sampleCount).toBe(4);
    expect(ys).toEqual([0, 0.5, 1]);
    expect(ys.every((value, index) => index === 0 || value >= ys[index - 1])).toBe(true);
    expect(model.fittedParametersDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('is invariant to input ordering', () => {
    const a = fitIsotonicCalibration(violating);
    const b = fitIsotonicCalibration([...violating].reverse());
    expect(b).toEqual(a);
  });

  it('groups identical raw probabilities before PAV', () => {
    const model = fitIsotonicCalibration([
      sample('a', 0.2, 0),
      sample('b', 0.2, 1),
      sample('c', 0.8, 1),
    ]);
    expect(model.blocks[0]).toMatchObject({
      minRawProbability: 0.2,
      maxRawProbability: 0.2,
      calibratedProbability: 0.5,
      sampleCount: 2,
    });
  });

  it('rejects mixed execution profiles or predicates', () => {
    expect(() => fitIsotonicCalibration([
      sample('a', 0.1, 0, d('1')),
      sample('b', 0.9, 1, d('e')),
    ])).toThrow(/execution profile/i);

    expect(() => fitIsotonicCalibration([
      sample('a', 0.1, 0, d('1'), 'still_needed'),
      sample('b', 0.9, 1, d('1'), 'full_content_needed'),
    ])).toThrow(/predicate/i);
  });

  it('applies boundary clamping inside the valid probability domain', () => {
    const model = fitIsotonicCalibration(violating);
    expect(applyIsotonicCalibration(model, 0)).toBe(0);
    expect(applyIsotonicCalibration(model, 1)).toBe(1);
    expect(() => applyIsotonicCalibration(model, -0.01)).toThrow(/probability/i);
  });
});
