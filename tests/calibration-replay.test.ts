import { describe, expect, it } from 'vitest';
import { joinCalibrationReplay } from '../src/lab/calibration-replay.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

const labels = [
  {
    labelId: 'b',
    authority: 'STRONG' as const,
    decisionContractDigest: d('1'),
    predicateId: 'still_needed' as const,
    labelBindingDigest: d('2'),
    sourceDigest: d('3'),
    outcomeDigest: d('4'),
    target: 1 as const,
    verifierIdentity: 'deterministic:b',
  },
  {
    labelId: 'a',
    authority: 'STRONG' as const,
    decisionContractDigest: d('1'),
    predicateId: 'still_needed' as const,
    labelBindingDigest: d('2'),
    sourceDigest: d('5'),
    outcomeDigest: d('6'),
    target: 0 as const,
    verifierIdentity: 'deterministic:a',
  },
];

const predictions = [
  {
    labelId: 'a',
    predicateId: 'still_needed' as const,
    sourceDigest: d('5'),
    executionProfileDigest: d('7'),
    observationDigest: d('8'),
    probability: 0.2,
  },
  {
    labelId: 'b',
    predicateId: 'still_needed' as const,
    sourceDigest: d('3'),
    executionProfileDigest: d('7'),
    observationDigest: d('9'),
    probability: 0.9,
  },
];

describe('new-profile calibration replay join', () => {
  it('joins exact STRONG labels to fresh predictions independent of input order', () => {
    const first = joinCalibrationReplay(labels, predictions);
    const second = joinCalibrationReplay([...labels].reverse(), [...predictions].reverse());

    expect(first.map((sample) => sample.labelId)).toEqual(['a', 'b']);
    expect(second).toEqual(first);
    expect(first.map((sample) => sample.target)).toEqual([0, 1]);
    expect(first.every((sample) => sample.executionProfileDigest === d('7'))).toBe(true);
  });

  it('fails closed on stale source identity', () => {
    expect(() => joinCalibrationReplay(labels, [
      { ...predictions[0], sourceDigest: d('f') },
      predictions[1],
    ])).toThrow(/source identity mismatch/i);
  });

  it('fails closed on missing or unknown prediction ids', () => {
    expect(() => joinCalibrationReplay(labels, [predictions[0]]))
      .toThrow(/cardinality|label id set/i);

    expect(() => joinCalibrationReplay(labels, [
      predictions[0],
      { ...predictions[1], labelId: 'unknown' },
    ])).toThrow(/label id set|unknown/i);
  });

  it('rejects mixed execution profiles in one calibration replay batch', () => {
    expect(() => joinCalibrationReplay(labels, [
      predictions[0],
      { ...predictions[1], executionProfileDigest: d('e') },
    ])).toThrow(/execution profile/i);
  });

  it('rejects WEAK labels from authoritative calibration replay', () => {
    expect(() => joinCalibrationReplay([
      { ...labels[0], authority: 'WEAK' as const, verifierIdentity: undefined },
    ], [predictions[1]])).toThrow(/STRONG/i);
  });
});
