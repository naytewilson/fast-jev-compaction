import { describe, expect, it } from 'vitest';
import {
  validateMechanicalRecoveryAttestation,
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
  it('contains exactly four modeled semantic axes and no recoverability score', () => {
    expect(validateSemanticSensorObservationV2(identity, observation))
      .toEqual({ ok: true });
    expect('recoverable' in observation.predicates).toBe(false);

    expect(validateSemanticSensorObservationV2(identity, {
      ...observation,
      predicates: {
        ...observation.predicates,
        recoverable: 0.99,
      },
    })).toMatchObject({ ok: false, code: 'invalid_predicates' });
  });

  it('rejects lane identity drift', () => {
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

  it('validates recovery only through a mechanical attestation', () => {
    const attestation = {
      schema: 'anvil.mechanical-recovery-attestation.v1',
      candidateId: identity.candidateId,
      sourceDigest: identity.sourceDigest,
      recoveryRef: 'cas:object-1',
      status: 'VERIFIED',
    };
    expect(validateMechanicalRecoveryAttestation(identity, attestation))
      .toEqual({ ok: true });

    expect(validateMechanicalRecoveryAttestation(identity, {
      ...attestation,
      status: 'MODEL_SAYS_YES',
    })).toMatchObject({ ok: false, code: 'invalid_recovery_status' });
  });
});
