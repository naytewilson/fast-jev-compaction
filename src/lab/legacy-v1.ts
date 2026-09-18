import {
  MAPPED_DECISION_REQUEST_SCHEMA,
  type MappedCandidateView,
  type MappedRequestValidationResult,
  type MappedSharedConversationState,
  type NoulObservation,
  type ProfileIdentity,
} from './types.js';
import { validateMappedDecisionRequest } from './mapped-contract.js';
import {
  validateSemanticObservationEnvelope,
  type ObservationABIValidationResult,
  type SemanticLaneIdentity,
} from './observation-abi.js';
import { sha256Digest } from './recovery.js';

export const LEGACY_MAPPED_DECISION_REQUEST_SCHEMA_V0 =
  'anvil.mapped-decision-request.v0' as const;
export const LEGACY_MAPPED_DECISION_RESPONSE_SCHEMA_V0 =
  'anvil.mapped-decision-response.v0' as const;
export const LEGACY_SEMANTIC_OBSERVATION_ABI_V1 =
  'anvil.semantic-observation-abi.v1' as const;

export const LEGACY_MAPPED_OBSERVATION_AXES_V1 = [
  'evidence_sufficient',
  'still_needed',
  'full_content_needed',
  'unresolved_evidence',
  'recoverable',
] as const;

export type LegacyMappedObservationAxisV1 =
  (typeof LEGACY_MAPPED_OBSERVATION_AXES_V1)[number];

export interface LegacyMappedDecisionRequestV0 {
  schema: typeof LEGACY_MAPPED_DECISION_REQUEST_SCHEMA_V0;
  request_id: string;
  source_run_id: string;
  decision_contract: ProfileIdentity;
  execution_profile: ProfileIdentity;
  calibration_profile: ProfileIdentity;
  policy_profile: ProfileIdentity;
  shared_conversation_state: MappedSharedConversationState;
  candidate_views: MappedCandidateView[];
}

export interface LegacyMappedCandidateObservationV0 {
  candidate_id: string;
  evidence_sufficient: NoulObservation;
  still_needed: NoulObservation;
  full_content_needed: NoulObservation;
  unresolved_evidence: NoulObservation;
  recoverable: NoulObservation;
}

export interface LegacyMappedDecisionResponseV0 {
  schema: typeof LEGACY_MAPPED_DECISION_RESPONSE_SCHEMA_V0;
  request_id: string;
  observations: LegacyMappedCandidateObservationV0[];
}

export type LegacyMappedObservationResultV0 =
  | { kind: 'OBSERVATIONS'; observations: LegacyMappedCandidateObservationV0[] }
  | { kind: 'PRISTINE_FALLBACK'; code: string; detail: string };

export interface LegacySemanticObservationEnvelopeV1 extends SemanticLaneIdentity {
  schema: typeof LEGACY_SEMANTIC_OBSERVATION_ABI_V1;
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

export interface LegacyRegisteredSemanticPredicateV1 {
  id: LegacyMappedObservationAxisV1;
  requiresEvidenceSufficient: boolean;
  semanticDefinition: string;
}

export interface LegacyRegisteredSemanticProgramV1 {
  schema: 'anvil.registered-semantic-program.v1';
  id: 'anvil.context-retention.v1';
  version: '1.0.0';
  decisionContract: ProfileIdentity;
  observationABIVersion: typeof LEGACY_SEMANTIC_OBSERVATION_ABI_V1;
  predicates: readonly LegacyRegisteredSemanticPredicateV1[];
  programDigest: string;
}

const LEGACY_PROGRAM_DEFINITIONS: Record<LegacyMappedObservationAxisV1, string> = {
  evidence_sufficient:
    'The bounded source view and shared state are sufficient to judge the registered retention predicates.',
  still_needed:
    'The source-bound candidate carries information likely needed for the active mission.',
  full_content_needed:
    'Replacing omitted source content with an exact reversible reference would materially reduce usefulness.',
  unresolved_evidence:
    'The candidate contains unresolved failure, warning, contradiction, dependency, or verification evidence.',
  recoverable:
    'The candidate appears semantically recoverable through its declared identity; mechanical recovery remains separately authoritative.',
};

const LEGACY_RESPONSE_KEYS = ['schema', 'request_id', 'observations'] as const;
const LEGACY_OBSERVATION_KEYS = [
  'candidate_id',
  ...LEGACY_MAPPED_OBSERVATION_AXES_V1,
] as const;
const LEGACY_ENVELOPE_KEYS = [
  'schema',
  'candidateId',
  'originalOrdinal',
  'sourceDigest',
  'programDigest',
  'evidenceSufficient',
  'predicates',
  'telemetry',
] as const;
const LEGACY_PREDICATE_KEYS = [
  'stillNeeded',
  'fullContentNeeded',
  'unresolvedEvidence',
  'recoverable',
] as const;
const AXIS_KEYS = ['noul'] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(
  object: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(object);
  return actual.length === expected.length &&
    actual.every((key) => expected.includes(key));
}

function probability(value: unknown): value is number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1;
}

function validAxis(value: unknown): value is NoulObservation {
  return isObject(value) &&
    exactKeys(value, AXIS_KEYS) &&
    probability(value.noul);
}

function requestFailure(code: string, detail: string): MappedRequestValidationResult {
  return { ok: false, code, detail };
}

function observationFailure(
  code: string,
  detail: string,
): ObservationABIValidationResult {
  return { ok: false, code, detail };
}

function legacyFallback(
  code: string,
  detail: string,
): LegacyMappedObservationResultV0 {
  return { kind: 'PRISTINE_FALLBACK', code, detail };
}

export function validateLegacyMappedDecisionRequestV0(
  value: unknown,
): MappedRequestValidationResult {
  if (!isObject(value) ||
      value.schema !== LEGACY_MAPPED_DECISION_REQUEST_SCHEMA_V0) {
    return requestFailure(
      'invalid_request_schema',
      'legacy mapped request schema must be anvil.mapped-decision-request.v0',
    );
  }

  return validateMappedDecisionRequest({
    ...value,
    schema: MAPPED_DECISION_REQUEST_SCHEMA,
  });
}

export function reassembleLegacyMappedObservationsV0(
  requestID: string,
  candidateIDs: readonly string[],
  payload: unknown,
): LegacyMappedObservationResultV0 {
  if (!isObject(payload) || !exactKeys(payload, LEGACY_RESPONSE_KEYS)) {
    return legacyFallback(
      'malformed_response',
      'legacy provider response has unexpected or missing top-level fields',
    );
  }
  if (payload.schema !== LEGACY_MAPPED_DECISION_RESPONSE_SCHEMA_V0) {
    return legacyFallback(
      'malformed_response',
      'legacy provider response schema mismatch',
    );
  }
  if (payload.request_id !== requestID) {
    return legacyFallback(
      'request_id_mismatch',
      'legacy provider response request_id does not match request',
    );
  }
  if (!Array.isArray(payload.observations)) {
    return legacyFallback(
      'malformed_response',
      'legacy provider response observations must be an array',
    );
  }

  const expected = new Set(candidateIDs);
  if (expected.size !== candidateIDs.length) {
    return legacyFallback(
      'invalid_expected_candidates',
      'expected candidate ids are not unique',
    );
  }
  if (payload.observations.length !== candidateIDs.length) {
    return legacyFallback(
      'cardinality_mismatch',
      'legacy provider response observation count does not match candidate count',
    );
  }

  const byID = new Map<string, LegacyMappedCandidateObservationV0>();
  for (let index = 0; index < payload.observations.length; index += 1) {
    const raw = payload.observations[index];
    if (!isObject(raw) || !exactKeys(raw, LEGACY_OBSERVATION_KEYS)) {
      return legacyFallback(
        'malformed_observation',
        'legacy observation[' + index + '] has unexpected or missing fields',
      );
    }
    if (typeof raw.candidate_id !== 'string') {
      return legacyFallback(
        'malformed_observation',
        'legacy observation[' + index + '].candidate_id must be a string',
      );
    }
    if (!expected.has(raw.candidate_id)) {
      return legacyFallback(
        'candidate_key_mismatch',
        'unknown legacy candidate_id ' + raw.candidate_id,
      );
    }
    if (byID.has(raw.candidate_id)) {
      return legacyFallback(
        'duplicate_candidate_id',
        'duplicate legacy candidate_id ' + raw.candidate_id,
      );
    }

    for (const axis of LEGACY_MAPPED_OBSERVATION_AXES_V1) {
      if (!validAxis(raw[axis])) {
        return legacyFallback(
          'invalid_observation_axis',
          raw.candidate_id + '.' + axis + ' is malformed or outside [0,1]',
        );
      }
    }

    byID.set(
      raw.candidate_id,
      raw as unknown as LegacyMappedCandidateObservationV0,
    );
  }

  for (const candidateID of candidateIDs) {
    if (!byID.has(candidateID)) {
      return legacyFallback(
        'candidate_key_mismatch',
        'missing legacy candidate_id ' + candidateID,
      );
    }
  }

  return {
    kind: 'OBSERVATIONS',
    observations: candidateIDs.map((candidateID) => byID.get(candidateID)!),
  };
}

export function validateLegacySemanticObservationEnvelopeV1(
  expected: SemanticLaneIdentity,
  value: unknown,
): ObservationABIValidationResult {
  if (!isObject(value) || !exactKeys(value, LEGACY_ENVELOPE_KEYS)) {
    return observationFailure(
      'invalid_observation_schema',
      'legacy observation envelope has unexpected or missing top-level fields',
    );
  }
  if (value.schema !== LEGACY_SEMANTIC_OBSERVATION_ABI_V1) {
    return observationFailure(
      'observation_abi_mismatch',
      'legacy observation ABI schema mismatch',
    );
  }
  if (!isObject(value.predicates) ||
      !exactKeys(value.predicates, LEGACY_PREDICATE_KEYS)) {
    return observationFailure(
      'invalid_predicates',
      'legacy predicate object has unexpected or missing fields',
    );
  }
  if (!probability(value.predicates.recoverable)) {
    return observationFailure(
      'invalid_probability',
      'legacy predicate recoverable must be finite in [0,1]',
    );
  }

  const projected = {
    ...value,
    schema: 'anvil.semantic-observation-abi.v2' as const,
    predicates: {
      stillNeeded: value.predicates.stillNeeded,
      fullContentNeeded: value.predicates.fullContentNeeded,
      unresolvedEvidence: value.predicates.unresolvedEvidence,
    },
  };

  return validateSemanticObservationEnvelope(expected, projected);
}

export function detectSemanticObservationABIVersion(
  value: unknown,
): 'v1' | 'v2' | null {
  if (!isObject(value)) return null;
  if (value.schema === LEGACY_SEMANTIC_OBSERVATION_ABI_V1) return 'v1';
  if (value.schema === 'anvil.semantic-observation-abi.v2') return 'v2';
  return null;
}

export function validateVersionedSemanticObservationEnvelope(
  expected: SemanticLaneIdentity,
  value: unknown,
): ObservationABIValidationResult {
  const version = detectSemanticObservationABIVersion(value);
  if (version === 'v1') {
    return validateLegacySemanticObservationEnvelopeV1(expected, value);
  }
  if (version === 'v2') {
    return validateSemanticObservationEnvelope(expected, value);
  }
  return observationFailure(
    'observation_abi_mismatch',
    'observation ABI version is unsupported',
  );
}

function frozenIdentity(identity: ProfileIdentity): ProfileIdentity {
  return Object.freeze({
    id: identity.id,
    version: identity.version,
    digest: identity.digest,
  });
}

export function compileLegacyContextRetentionProgramV1(
  decisionContract: ProfileIdentity,
): LegacyRegisteredSemanticProgramV1 {
  const predicates = LEGACY_MAPPED_OBSERVATION_AXES_V1.map((id) =>
    Object.freeze({
      id,
      requiresEvidenceSufficient: id !== 'evidence_sufficient',
      semanticDefinition: LEGACY_PROGRAM_DEFINITIONS[id],
    }),
  );

  const contract = frozenIdentity(decisionContract);
  const core = {
    schema: 'anvil.registered-semantic-program.v1' as const,
    id: 'anvil.context-retention.v1' as const,
    version: '1.0.0' as const,
    decisionContract: contract,
    observationABIVersion: LEGACY_SEMANTIC_OBSERVATION_ABI_V1,
    predicates,
  };

  return Object.freeze({
    ...core,
    predicates: Object.freeze(predicates),
    programDigest: sha256Digest(JSON.stringify(core)),
  });
}
