import { describe, expect, it } from 'vitest';
import {
  planSemanticMicrobatches,
  reassemblePackedLaneResults,
} from '../src/lab/lane-planner.js';

const digest = (c: string) => 'sha256:' + c.repeat(64);
const mask = (source: boolean) => ({
  source,
  evidence: false,
  calibration: false,
  authority: false,
  recovery: false,
});

describe('Active-Lane Shape Planner', () => {
  it('gathers only source-valid lanes and packs deterministically by bucket then ordinal', () => {
    const plan = planSemanticMicrobatches([
      { originalOrdinal: 0, candidateId: 'cand-a', sourceDigest: digest('a'), tokenEstimate: 60, mask: mask(true) },
      { originalOrdinal: 1, candidateId: 'cand-b', sourceDigest: digest('b'), tokenEstimate: 10, mask: mask(false) },
      { originalOrdinal: 2, candidateId: 'cand-c', sourceDigest: digest('c'), tokenEstimate: 10, mask: mask(true) },
      { originalOrdinal: 3, candidateId: 'cand-d', sourceDigest: digest('d'), tokenEstimate: 30, mask: mask(true) },
    ], { shapeBuckets: [16, 32, 64], maxBatchSize: 2 });

    expect(plan.packedLanes.map((lane) => lane.candidateId)).toEqual([
      'cand-c',
      'cand-d',
      'cand-a',
    ]);
    expect(plan.packedLanes.map((lane) => lane.originalOrdinal)).toEqual([2, 3, 0]);
  });

  it('reassembles exact packed results into original semantic ordinal order', () => {
    const plan = planSemanticMicrobatches([
      { originalOrdinal: 0, candidateId: 'cand-a', sourceDigest: digest('a'), tokenEstimate: 40, mask: mask(true) },
      { originalOrdinal: 1, candidateId: 'cand-b', sourceDigest: digest('b'), tokenEstimate: 10, mask: mask(true) },
    ], { shapeBuckets: [16, 64], maxBatchSize: 4 });

    const restored = reassemblePackedLaneResults(plan, [
      { packedIndex: 0, candidateId: 'cand-b', value: 'B' },
      { packedIndex: 1, candidateId: 'cand-a', value: 'A' },
    ]);

    expect(restored.map((result) => result.value)).toEqual(['A', 'B']);
  });

  it('fails closed on candidate identity drift during scatter', () => {
    const plan = planSemanticMicrobatches([
      { originalOrdinal: 0, candidateId: 'cand-a', sourceDigest: digest('a'), tokenEstimate: 1, mask: mask(true) },
    ], { shapeBuckets: [16], maxBatchSize: 1 });

    expect(() => reassemblePackedLaneResults(plan, [
      { packedIndex: 0, candidateId: 'cand-other', value: 'x' },
    ])).toThrow(/candidate identity mismatch/i);
  });

  it('rejects duplicate ordinals and duplicate candidate ids before packing', () => {
    expect(() => planSemanticMicrobatches([
      { originalOrdinal: 0, candidateId: 'cand-a', sourceDigest: digest('a'), tokenEstimate: 1, mask: mask(true) },
      { originalOrdinal: 0, candidateId: 'cand-b', sourceDigest: digest('b'), tokenEstimate: 2, mask: mask(true) },
    ], { shapeBuckets: [16], maxBatchSize: 2 })).toThrow(/duplicate ordinal/i);

    expect(() => planSemanticMicrobatches([
      { originalOrdinal: 0, candidateId: 'cand-a', sourceDigest: digest('a'), tokenEstimate: 1, mask: mask(true) },
      { originalOrdinal: 1, candidateId: 'cand-a', sourceDigest: digest('b'), tokenEstimate: 2, mask: mask(true) },
    ], { shapeBuckets: [16], maxBatchSize: 2 })).toThrow(/duplicate candidate/i);
  });
});
