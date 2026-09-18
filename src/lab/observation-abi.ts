export interface SemanticLaneIdentity {
  candidateId: string;
  originalOrdinal: number;
  sourceDigest: string;
  programDigest: string;
}

export interface SemanticObservationEnvelope extends SemanticLaneIdentity {
  schema: 'anvil.semantic-observation-abi.v1';
  evidenceSufficient: number;
  predicates: {
    stillNeeded: number;
    fullContentNeeded: number;
    unresolvedEvidence: number;
    recoverable: number;
  };
  telemetry: {
    entropy: number | null;
    margin: number | null;
  };
}

export type ObservationABIValidationResult =
  | { ok: true }
  | { ok: false; code: string; detail: string };

const TOP_LEVEL_KEYS = [
  'schema',
  'candidateId',
  'originalOrdinal',
  'sourceDigest',
  'programDigest',
  'evidenceSufficient',
  'predicates',
  'telemetry',
] as const;

const PREDICATE_KEYS = [
  'stillNeeded',
  'fullContentNeeded',
  'unresolvedEvidence',
  'recoverable',
] as const;

const TELEMETRY_KEYS = ['entropy', 'margin'] as const;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function fail(code: string, detail: string): ObservationABIValidationResult {
  return { ok: false, code, detail };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function probability(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function optionalFinite(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

export function validateSemanticObservationEnvelope(
  expected: SemanticLaneIdentity,
  value: unknown,
): ObservationABIValidationResult {
  if (!isObject(value) || !exactKeys(value, TOP_LEVEL_KEYS)) {
    return fail(
      'invalid_observation_schema',
      'observation envelope has unexpected or missing top-level fields',
    );
  }

  if (value.schema !== 'anvil.semantic-observation-abi.v1') {
    return fail('observation_abi_mismatch', 'observation ABI schema mismatch');
  }

  if (
    typeof value.candidateId !== 'string' ||
    typeof value.originalOrdinal !== 'number' ||
    typeof value.sourceDigest !== 'string' ||
    typeof value.programDigest !== 'string'
  ) {
    return fail('invalid_lane_identity', 'lane identity fields are malformed');
  }

  if (
    value.candidateId !== expected.candidateId ||
    value.originalOrdinal !== expected.originalOrdinal ||
    value.sourceDigest !== expected.sourceDigest ||
    value.programDigest !== expected.programDigest
  ) {
    return fail('lane_identity_mismatch', 'observation does not bind the expected lane identity');
  }

  if (!Number.isSafeInteger(value.originalOrdinal) || value.originalOrdinal < 0) {
    return fail('invalid_lane_ordinal', 'originalOrdinal must be a non-negative safe integer');
  }

  if (!DIGEST.test(value.sourceDigest) || !DIGEST.test(value.programDigest)) {
    return fail('invalid_lane_digest', 'source/program digests must be canonical sha256');
  }

  if (!probability(value.evidenceSufficient)) {
    return fail('invalid_probability', 'evidenceSufficient must be finite in [0,1]');
  }

  if (!isObject(value.predicates) || !exactKeys(value.predicates, PREDICATE_KEYS)) {
    return fail('invalid_predicates', 'predicate object has unexpected or missing fields');
  }

  for (const key of PREDICATE_KEYS) {
    if (!probability(value.predicates[key])) {
      return fail('invalid_probability', `predicate ${key} must be finite in [0,1]`);
    }
  }

  if (!isObject(value.telemetry) || !exactKeys(value.telemetry, TELEMETRY_KEYS)) {
    return fail('invalid_telemetry', 'telemetry object has unexpected or missing fields');
  }

  for (const key of TELEMETRY_KEYS) {
    if (!optionalFinite(value.telemetry[key])) {
      return fail('invalid_telemetry', `telemetry ${key} must be null or finite`);
    }
  }

  return { ok: true };
}
