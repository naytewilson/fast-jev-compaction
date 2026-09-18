import { describe, expect, it } from 'vitest';
import {
  validateSemanticSensorObservationV2,
} from '../src/lab/observation-abi-v2.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

const identity = {
  candidateId: 'cand-0001',
  originalOrdinal: 2,
  sourceDigest: d('a'),
  programDigest: d('b'),
};

const observation = {
  schema: 'anvil.semantic-observation-abi.v2',
  ...identity,
  evidenceSufficient: 0.61,
  predicates: {
    stillNeeded: 0.9,
    fullContentNeeded: 0.2,
    unresolvedEvidence: 0.1,
  },
  telemetry: {
    entropy: null,
    margin: null,
  },
};

describe('Semantic Observation ABI v2', () => {
  it('contains exactly four modeled semantic axes and no recovery authority', () => {
    expect(validateSemanticSensorObservationV2(identity, observation))
      .toEqual({ ok: true });
    expect('recoverable' in observation.predicates).toBe(false);
    expect('recoveryRef' in observation).toBe(false);

    expect(validateSemanticSensorObservationV2(identity, {
      ...observation,
      predicates: {
        ...observation.predicates,
        recoverable: 0.99,
      },
    })).toMatchObject({ ok: false, code: 'invalid_predicates' });
  });

  it('rejects candidate, ordinal, source, or program identity drift', () => {
    for (const patch of [
      { candidateId: 'cand-other' },
      { originalOrdinal: 3 },
      { sourceDigest: d('c') },
      { programDigest: d('d') },
    ]) {
      expect(validateSemanticSensorObservationV2(identity, {
        ...observation,
        ...patch,
      }).ok).toBe(false);
    }
  });

  it('rejects invalid probabilities and extra authority fields', () => {
    expect(validateSemanticSensorObservationV2(identity, {
      ...observation,
      evidenceSufficient: Number.NaN,
    }).ok).toBe(false);

    expect(validateSemanticSensorObservationV2(identity, {
      ...observation,
      authorized: true,
    })).toMatchObject({ ok: false, code: 'invalid_observation_schema' });
  });
});
