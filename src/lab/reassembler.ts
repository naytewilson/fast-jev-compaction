import {
  MAPPED_DECISION_RESPONSE_SCHEMA,
  MAPPED_OBSERVATION_AXES,
  type MappedCandidateObservation,
  type MappedObservationResult,
} from './types.js';

const RESPONSE_KEYS = ['schema', 'request_id', 'observations'] as const;
const OBSERVATION_KEYS = ['candidate_id', ...MAPPED_OBSERVATION_AXES] as const;
const AXIS_KEYS = ['noul'] as const;

function fallback(code: string, detail: string): MappedObservationResult {
  return { kind: 'PRISTINE_FALLBACK', code, detail };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(object: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(object);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function validAxis(value: unknown): value is { noul: number } {
  if (!isObject(value) || !exactKeys(value, AXIS_KEYS)) return false;
  return (
    typeof value.noul === 'number' &&
    Number.isFinite(value.noul) &&
    value.noul >= 0 &&
    value.noul <= 1
  );
}

export function reassembleMappedObservations(
  requestID: string,
  candidateIDs: readonly string[],
  payload: unknown,
): MappedObservationResult {
  if (!isObject(payload) || !exactKeys(payload, RESPONSE_KEYS)) {
    return fallback('malformed_response', 'provider response has unexpected or missing top-level fields');
  }
  if (payload.schema !== MAPPED_DECISION_RESPONSE_SCHEMA) {
    return fallback('malformed_response', 'provider response schema mismatch');
  }
  if (payload.request_id !== requestID) {
    return fallback('request_id_mismatch', 'provider response request_id does not match request');
  }
  if (!Array.isArray(payload.observations)) {
    return fallback('malformed_response', 'provider response observations must be an array');
  }

  const expected = new Set(candidateIDs);
  if (expected.size !== candidateIDs.length) {
    return fallback('invalid_expected_candidates', 'expected candidate ids are not unique');
  }
  if (payload.observations.length !== candidateIDs.length) {
    return fallback('cardinality_mismatch', 'provider response observation count does not match candidate count');
  }

  const byID = new Map<string, MappedCandidateObservation>();
  for (let index = 0; index < payload.observations.length; index += 1) {
    const raw = payload.observations[index];
    if (!isObject(raw) || !exactKeys(raw, OBSERVATION_KEYS)) {
      return fallback('malformed_observation', `observation[${index}] has unexpected or missing fields`);
    }
    if (typeof raw.candidate_id !== 'string') {
      return fallback('malformed_observation', `observation[${index}].candidate_id must be a string`);
    }
    if (!expected.has(raw.candidate_id)) {
      return fallback('candidate_key_mismatch', `unknown candidate_id ${raw.candidate_id}`);
    }
    if (byID.has(raw.candidate_id)) {
      return fallback('duplicate_candidate_id', `duplicate candidate_id ${raw.candidate_id}`);
    }

    for (const axis of MAPPED_OBSERVATION_AXES) {
      if (!validAxis(raw[axis])) {
        return fallback('invalid_observation_axis', `${raw.candidate_id}.${axis} is malformed or outside [0,1]`);
      }
    }

    byID.set(raw.candidate_id, raw as unknown as MappedCandidateObservation);
  }

  for (const candidateID of candidateIDs) {
    if (!byID.has(candidateID)) {
      return fallback('candidate_key_mismatch', `missing candidate_id ${candidateID}`);
    }
  }

  return {
    kind: 'OBSERVATIONS',
    observations: candidateIDs.map((candidateID) => byID.get(candidateID)!),
  };
}
