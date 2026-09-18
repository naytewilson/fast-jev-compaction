import { describe, expect, it } from 'vitest';
import { validateSemanticObservationEnvelope } from '../src/lab/observation-abi.js';

const digest = (c: string) => 'sha256:' + c.repeat(64);

const expected = {
  candidateId: 'cand-a',
  originalOrdinal: 3,
  sourceDigest: digest('a'),
  programDigest: digest('b'),
};

const valid = {
  schema: 'anvil.semantic-observation-abi.v1',
  ...expected,
  evidenceSufficient: 0.91,
  predicates: {
    stillNeeded: 0.8,
    fullContentNeeded: 0.2,
    unresolvedEvidence: 0.1,
    recoverable: 0.99,
  },
  telemetry: {
    entropy: null,
    margin: null,
  },
};

describe('Semantic Observation ABI', () => {
  it('accepts an exact observation-only lane envelope', () => {
    expect(validateSemanticObservationEnvelope(expected, valid)).toEqual({ ok: true });
  });

  it('rejects candidate, ordinal, source, or program identity drift', () => {
    for (const patch of [
      { candidateId: 'cand-other' },
      { originalOrdinal: 4 },
      { sourceDigest: digest('c') },
      { programDigest: digest('d') },
    ]) {
      expect(validateSemanticObservationEnvelope(expected, { ...valid, ...patch }).ok).toBe(false);
    }
  });

  it('rejects non-finite or out-of-domain probabilities', () => {
    expect(validateSemanticObservationEnvelope(expected, {
      ...valid,
      evidenceSufficient: Number.NaN,
    }).ok).toBe(false);

    expect(validateSemanticObservationEnvelope(expected, {
      ...valid,
      predicates: { ...valid.predicates, stillNeeded: 1.1 },
    }).ok).toBe(false);
  });

  it('has no policy execution field', () => {
    expect(validateSemanticObservationEnvelope(expected, {
      ...valid,
      authorized: true,
    }).ok).toBe(false);
  });
});
