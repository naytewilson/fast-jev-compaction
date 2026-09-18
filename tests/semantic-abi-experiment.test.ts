import { describe, expect, it } from 'vitest';
import {
  FOUR_AXIS_EXPERIMENT_AXES,
  FIVE_AXIS_EXPERIMENT_AXES,
  compareSharedAxisObservations,
  observationQuestionCount,
} from '../src/lab/semantic-abi-experiment.js';

describe('semantic ABI experiment harness', () => {
  it('keeps the five-axis historical experiment arm intact', () => {
    expect(FIVE_AXIS_EXPERIMENT_AXES).toEqual([
      'evidence_sufficient',
      'still_needed',
      'full_content_needed',
      'unresolved_evidence',
      'recoverable',
    ]);
  });

  it('defines a four-axis candidate arm without modeled recoverable', () => {
    expect(FOUR_AXIS_EXPERIMENT_AXES).toEqual([
      'evidence_sufficient',
      'still_needed',
      'full_content_needed',
      'unresolved_evidence',
    ]);
    expect(FOUR_AXIS_EXPERIMENT_AXES).not.toContain('recoverable');
  });

  it('computes question counts from candidate count and axis count', () => {
    expect(observationQuestionCount(3, FIVE_AXIS_EXPERIMENT_AXES)).toBe(15);
    expect(observationQuestionCount(3, FOUR_AXIS_EXPERIMENT_AXES)).toBe(12);
    expect(() => observationQuestionCount(-1, FOUR_AXIS_EXPERIMENT_AXES))
      .toThrow(/candidate/i);
  });

  it('compares only shared axes with deterministic candidate/axis ordering', () => {
    const deltas = compareSharedAxisObservations(
      [
        {
          candidateId: 'b',
          values: {
            evidence_sufficient: 0.7,
            still_needed: 0.8,
            full_content_needed: 0.4,
            unresolved_evidence: 0.2,
            recoverable: 0.99,
          },
        },
        {
          candidateId: 'a',
          values: {
            evidence_sufficient: 0.2,
            still_needed: 0.3,
            full_content_needed: 0.4,
            unresolved_evidence: 0.5,
            recoverable: 0.9,
          },
        },
      ],
      [
        {
          candidateId: 'a',
          values: {
            evidence_sufficient: 0.25,
            still_needed: 0.35,
            full_content_needed: 0.45,
            unresolved_evidence: 0.55,
          },
        },
        {
          candidateId: 'b',
          values: {
            evidence_sufficient: 0.65,
            still_needed: 0.75,
            full_content_needed: 0.35,
            unresolved_evidence: 0.15,
          },
        },
      ],
    );

    expect(deltas).toHaveLength(8);
    expect(deltas[0]).toEqual({
      candidateId: 'a',
      axis: 'evidence_sufficient',
      fiveAxisProbability: 0.2,
      fourAxisProbability: 0.25,
      absoluteDelta: 0.05,
    });
    expect(deltas.every((row) => row.axis !== ('recoverable' as any))).toBe(true);
  });

  it('fails closed when candidate sets or shared-axis values are incomplete', () => {
    expect(() => compareSharedAxisObservations(
      [{ candidateId: 'a', values: { evidence_sufficient: 0.2 } }],
      [{ candidateId: 'b', values: { evidence_sufficient: 0.2 } }],
    )).toThrow(/candidate/i);

    expect(() => compareSharedAxisObservations(
      [{ candidateId: 'a', values: { evidence_sufficient: 0.2 } }],
      [{ candidateId: 'a', values: { evidence_sufficient: 0.2 } }],
    )).toThrow(/axis/i);
  });
});
