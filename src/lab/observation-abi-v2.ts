export const SEMANTIC_SENSOR_ABI_V2_SCHEMA =
  'anvil.semantic-observation-abi.v2' as const;
export const MECHANICAL_RECOVERY_ATTESTATION_SCHEMA =
  'anvil.mechanical-recovery-attestation.v1' as const;

export const SEMANTIC_SENSOR_AXES_V2 = [
  'evidence_sufficient',
  'still_needed',
  'full_content_needed',
  'unresolved_evidence',
] as const;

export type SemanticSensorAxisV2 =
  (typeof SEMANTIC_SENSOR_AXES_V2)[number];

export interface SemanticSensorLaneIdentity {
  candidateId: string;
  originalOrdinal: number;
  sourceDigest: string;
  programDigest: string;
}

export interface SemanticSensorObservationV2 extends SemanticSensorLaneIdentity {
  schema: typeof SEMANTIC_SENSOR_ABI_V2_SCHEMA;
  evidenceSufficient: number;
  predicates: {
    stillNeeded: number;
    fullContentNeeded: number;
    unresolvedEvidence: number;
  };
  telemetry: {
    entropy: number | null;
    margin: number | null;
  };
}

export type MechanicalRecoveryStatus =
  | 'VERIFIED'
  | 'MISSING'
  | 'DIGEST_MISMATCH'
  | 'STALE';

export interface MechanicalRecoveryAttestation {
  schema: typeof MECHANICAL_RECOVERY_ATTESTATION_SCHEMA;
  candidateId: string;
  sourceDigest: string;
  recoveryRef: string;
  status: MechanicalRecoveryStatus;
}

export type SensorV2ValidationResult =
  | { ok: true }
  | { ok: false; code: string; detail: string };

const OBSERVATION_KEYS = [
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
] as const;
const TELEMETRY_KEYS = ['entropy', 'margin'] as const;
const RECOVERY_KEYS = [
  'schema',
  'candidateId',
  'sourceDigest',
  'recoveryRef',
  'status',
] as const;
const RECOVERY_STATUSES = new Set<MechanicalRecoveryStatus>([
  'VERIFIED',
  'MISSING',
  'DIGEST_MISMATCH',
  'STALE',
]);
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const CAS_REF = /^cas:[A-Za-z0-9._:-]+$/;

function fail(code: string, detail: string): SensorV2ValidationResult {
  return { ok: false, code, detail };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length &&
    actual.every((key) => expected.includes(key));
}

function probability(value: unknown): value is number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1;
}

function optionalFinite(value: unknown): value is number | null {
  return value === null ||
    (typeof value === 'number' && Number.isFinite(value));
}

export function validateSemanticSensorObservationV2(
  expected: SemanticSensorLaneIdentity,
  value: unknown,
): SensorV2ValidationResult {
  if (!isObject(value) || !exactKeys(value, OBSERVATION_KEYS)) {
    return fail(
      'invalid_observation_schema',
      'v2 observation has unexpected or missing top-level fields',
    );
  }
  if (value.schema !== SEMANTIC_SENSOR_ABI_V2_SCHEMA) {
    return fail('observation_abi_mismatch', 'v2 observation schema mismatch');
  }
  if (
    typeof value.candidateId !== 'string' ||
    !Number.isSafeInteger(value.originalOrdinal) ||
    typeof value.sourceDigest !== 'string' ||
    typeof value.programDigest !== 'string'
  ) {
    return fail('invalid_lane_identity', 'v2 lane identity is malformed');
  }
  if ((value.originalOrdinal as number) < 0) {
    return fail('invalid_lane_ordinal', 'originalOrdinal must be non-negative');
  }
  if (
    value.candidateId !== expected.candidateId ||
    value.originalOrdinal !== expected.originalOrdinal ||
    value.sourceDigest !== expected.sourceDigest ||
    value.programDigest !== expected.programDigest
  ) {
    return fail(
      'lane_identity_mismatch',
      'v2 observation does not bind the expected lane identity',
    );
  }
  if (!DIGEST.test(value.sourceDigest) || !DIGEST.test(value.programDigest)) {
    return fail(
      'invalid_lane_digest',
      'source/program digests must be canonical sha256',
    );
  }
  if (!probability(value.evidenceSufficient)) {
    return fail(
      'invalid_probability',
      'evidenceSufficient must be finite in [0,1]',
    );
  }
  if (!isObject(value.predicates) ||
      !exactKeys(value.predicates, PREDICATE_KEYS)) {
    return fail(
      'invalid_predicates',
      'v2 predicate object must contain exactly stillNeeded, fullContentNeeded, unresolvedEvidence',
    );
  }
  for (const key of PREDICATE_KEYS) {
    if (!probability(value.predicates[key])) {
      return fail(
        'invalid_probability',
        `predicate ${key} must be finite in [0,1]`,
      );
    }
  }
  if (!isObject(value.telemetry) ||
      !exactKeys(value.telemetry, TELEMETRY_KEYS)) {
    return fail(
      'invalid_telemetry',
      'v2 telemetry has unexpected or missing fields',
    );
  }
  for (const key of TELEMETRY_KEYS) {
    if (!optionalFinite(value.telemetry[key])) {
      return fail(
        'invalid_telemetry',
        `telemetry ${key} must be null or finite`,
      );
    }
  }
  return { ok: true };
}

export function validateMechanicalRecoveryAttestation(
  expected: Pick<SemanticSensorLaneIdentity, 'candidateId' | 'sourceDigest'>,
  value: unknown,
): SensorV2ValidationResult {
  if (!isObject(value) || !exactKeys(value, RECOVERY_KEYS)) {
    return fail(
      'invalid_recovery_schema',
      'mechanical recovery attestation has unexpected or missing fields',
    );
  }
  if (value.schema !== MECHANICAL_RECOVERY_ATTESTATION_SCHEMA) {
    return fail(
      'recovery_schema_mismatch',
      'mechanical recovery attestation schema mismatch',
    );
  }
  if (
    typeof value.candidateId !== 'string' ||
    typeof value.sourceDigest !== 'string' ||
    typeof value.recoveryRef !== 'string' ||
    typeof value.status !== 'string'
  ) {
    return fail(
      'invalid_recovery_identity',
      'mechanical recovery attestation fields are malformed',
    );
  }
  if (
    value.candidateId !== expected.candidateId ||
    value.sourceDigest !== expected.sourceDigest
  ) {
    return fail(
      'recovery_identity_mismatch',
      'mechanical recovery does not bind the expected candidate/source',
    );
  }
  if (!DIGEST.test(value.sourceDigest) || !CAS_REF.test(value.recoveryRef)) {
    return fail(
      'invalid_recovery_identity',
      'sourceDigest/recoveryRef are malformed',
    );
  }
  if (!RECOVERY_STATUSES.has(value.status as MechanicalRecoveryStatus)) {
    return fail(
      'invalid_recovery_status',
      'mechanical recovery status is not registered',
    );
  }
  return { ok: true };
}
