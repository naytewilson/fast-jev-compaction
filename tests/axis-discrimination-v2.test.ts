import { describe, expect, it } from 'vitest';
import {
  analyzeAxisDiscriminationV2,
  axisDiscriminationAnchorPlanV2,
  axisDiscriminationCorpusV2,
  verifyAxisDiscriminationCorpusV2,
} from '../src/lab/axis-discrimination-v2.js';
import { mintCampaignLabelsV2 } from '../src/lab/campaign-corpus-v2.js';
import type { SemanticReplayPredictionV2 } from '../src/lab/calibration-replay-v2.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

function fixture() {
  const traces = axisDiscriminationCorpusV2();
  const labels = mintCampaignLabelsV2({
    traces,
    decisionContractDigest: d('a'),
    labelBindingDigest: d('b'),
  });
  return { traces, labels };
}

function predictionsFor(
  labels: ReturnType<typeof fixture>['labels'],
  probability: (target: 0 | 1, index: number) => number,
): SemanticReplayPredictionV2[] {
  return labels.map((label, index) => ({
    labelId: label.labelId,
    predicateId: label.predicateId,
    sourceDigest: label.sourceDigest,
    executionProfileDigest: d('c'),
    observationDigest: d(index % 10 === 0 ? 'd' : String((index % 9) + 1)),
    probability: probability(label.target, index),
  }));
}

describe('V2 axis-discrimination anchor corpus', () => {
  it('contains exactly 16 source-bound anchors with mechanically proven primary targets', () => {
    const traces = axisDiscriminationCorpusV2();
    const anchors = axisDiscriminationAnchorPlanV2();
    const coverage = verifyAxisDiscriminationCorpusV2(traces);

    expect(traces).toHaveLength(16);
    expect(anchors).toHaveLength(16);
    expect(new Set(traces.map((trace) => trace.trace_id)).size).toBe(16);
    expect(new Set(traces.map((trace) => trace.candidates[0].recovery.source_digest)).size).toBe(16);
    for (const trace of traces) {
      expect(trace.candidates[0].stdout).not.toContain(trace.trace_id);
      expect(trace.candidates[0].stdout).not.toContain(trace.candidates[0].candidate_id);
    }

    const visibleUePositive = traces.find((trace) =>
      trace.trace_id === 'axis-ue-pos-02');
    expect(visibleUePositive).toBeDefined();
    expect(
      visibleUePositive!.candidates[0].stdout
        .split('\n')
        .slice(0, visibleUePositive!.candidates[0].head_lines)
        .join('\n'),
    ).toContain('verification mismatch');

    for (const axis of [
      'evidence_sufficient',
      'still_needed',
      'full_content_needed',
      'unresolved_evidence',
    ] as const) {
      expect(coverage[axis].positive).toBeGreaterThanOrEqual(2);
      expect(coverage[axis].negative).toBeGreaterThanOrEqual(2);
      expect(anchors.filter((anchor) => anchor.primaryAxis === axis && anchor.primaryTarget === 1)).toHaveLength(2);
      expect(anchors.filter((anchor) => anchor.primaryAxis === axis && anchor.primaryTarget === 0)).toHaveLength(2);

      const positiveMissions = anchors
        .filter((anchor) => anchor.primaryAxis === axis && anchor.primaryTarget === 1)
        .map((anchor) => traces.find((trace) => trace.trace_id === anchor.id)!.shared_state)
        .sort();
      const negativeMissions = anchors
        .filter((anchor) => anchor.primaryAxis === axis && anchor.primaryTarget === 0)
        .map((anchor) => traces.find((trace) => trace.trace_id === anchor.id)!.shared_state)
        .sort();
      expect(positiveMissions).toEqual(negativeMissions);
    }
  });

  it('classifies clean ordering as ORDERING_GOOD_BIAS_ONLY even when both classes exceed 0.5', () => {
    const { labels } = fixture();
    const report = analyzeAxisDiscriminationV2({
      labels,
      predictions: predictionsFor(labels, (target) => target === 1 ? 0.95 : 0.75),
    });

    expect(report.fullExpansionJustified).toBe(true);
    expect(report.semanticsRepairAxes).toEqual([]);
    expect(report.providerFitBlockerAxes).toEqual([]);
    for (const axis of Object.values(report.axes)) {
      expect(axis.classification).toBe('ORDERING_GOOD_BIAS_ONLY');
      expect(axis.accuracyAt05).toBeLessThan(1);
      expect(axis.minPositiveMinusMaxNegative).toBeGreaterThan(0);
      expect(axis.pairwiseOrderingRate).toBe(1);
    }
  });

  it('distinguishes overlapping-useful, non-discriminating, and inverted ordering without treating 0.5 as policy authority', () => {
    const { labels } = fixture();

    const overlapping = analyzeAxisDiscriminationV2({
      labels,
      predictions: predictionsFor(labels, (target, index) =>
        target === 1 ? (index % 2 === 0 ? 0.9 : 0.6) : (index % 2 === 0 ? 0.7 : 0.4)),
    });
    expect(Object.values(overlapping.axes).every((axis) =>
      axis.classification === 'OVERLAPPING_BUT_USABLE' ||
      axis.classification === 'ORDERING_GOOD_BIAS_ONLY')).toBe(true);

    const flat = analyzeAxisDiscriminationV2({
      labels,
      predictions: predictionsFor(labels, () => 0.5),
    });
    expect(Object.values(flat.axes).every((axis) => axis.classification === 'NON_DISCRIMINATING')).toBe(true);
    expect(flat.fullExpansionJustified).toBe(false);

    const inverted = analyzeAxisDiscriminationV2({
      labels,
      predictions: predictionsFor(labels, (target) => target === 1 ? 0.1 : 0.9),
    });
    expect(Object.values(inverted.axes).every((axis) => axis.classification === 'INVERTED')).toBe(true);
    expect(inverted.fullExpansionJustified).toBe(false);
    expect([...inverted.semanticsRepairAxes].sort()).toEqual([
      'full_content_needed',
      'unresolved_evidence',
    ]);
    expect([...inverted.providerFitBlockerAxes].sort()).toEqual([
      'evidence_sufficient',
      'still_needed',
    ]);
  });

  it('fails closed when prediction identity/cardinality does not exactly match the mechanical label set', () => {
    const { labels } = fixture();
    const predictions = predictionsFor(labels, (target) => target === 1 ? 0.9 : 0.1);
    expect(() => analyzeAxisDiscriminationV2({
      labels,
      predictions: predictions.slice(1),
    })).toThrow(/prediction|label|cardinality|missing/i);

    const duplicated = [...predictions, predictions[0]];
    expect(() => analyzeAxisDiscriminationV2({
      labels,
      predictions: duplicated,
    })).toThrow(/prediction|label|duplicate|cardinality/i);
  });
});
