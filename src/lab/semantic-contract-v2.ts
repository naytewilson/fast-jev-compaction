import { validateMappedDecisionRequest } from './mapped-contract.js';
import { sha256Digest } from './recovery.js';
import {
  MAPPED_DECISION_REQUEST_SCHEMA,
  type MappedCandidateView,
  type MappedSharedConversationState,
  type NoulObservation,
  type ProfileIdentity,
} from './types.js';

export const SEMANTIC_DECISION_REQUEST_SCHEMA_V2 =
  'anvil.semantic-decision-request.v2' as const;
export const SEMANTIC_DECISION_RESPONSE_SCHEMA_V2 =
  'anvil.semantic-decision-response.v2' as const;

export const MODELED_SEMANTIC_AXES_V2 = [
  'evidence_sufficient',
  'still_needed',
  'full_content_needed',
  'unresolved_evidence',
] as const;

export type ModeledSemanticAxisV2 =
  (typeof MODELED_SEMANTIC_AXES_V2)[number];

export const SEMANTIC_OBSERVATION_ABI_SPEC_V2 = Object.freeze({
  schema: 'anvil.semantic-observation-abi.v2' as const,
  modeledAxes: MODELED_SEMANTIC_AXES_V2,
  recoverabilityAuthority: 'mechanical-only' as const,
  unresolvedEvidenceSemantics: 'review-advisory-after-evidence-gate' as const,
});

export const SEMANTIC_OBSERVATION_ABI_DIGEST_V2 =
  sha256Digest(JSON.stringify(SEMANTIC_OBSERVATION_ABI_SPEC_V2));

export interface SemanticCandidateObservationV2 {
  candidate_id: string;
  evidence_sufficient: NoulObservation;
  still_needed: NoulObservation;
  full_content_needed: NoulObservation;
  unresolved_evidence: NoulObservation;
}

export interface SemanticDecisionRequestV2 {
  schema: typeof SEMANTIC_DECISION_REQUEST_SCHEMA_V2;
  request_id: string;
  source_run_id: string;
  decision_contract: ProfileIdentity;
  semantic_program: ProfileIdentity;
  execution_profile: ProfileIdentity;
  calibration_profile: ProfileIdentity;
  policy_profile: ProfileIdentity;
  shared_conversation_state: MappedSharedConversationState;
  candidate_views: MappedCandidateView[];
}

export interface SemanticDecisionResponseV2 {
  schema: typeof SEMANTIC_DECISION_RESPONSE_SCHEMA_V2;
  request_id: string;
  observations: SemanticCandidateObservationV2[];
}

export interface RegisteredSemanticPredicateV2 {
  id: ModeledSemanticAxisV2;
  requiresEvidenceSufficient: boolean;
  semanticDefinition: string;
}

export interface RegisteredSemanticProgramV2 {
  schema: 'anvil.registered-semantic-program.v2';
  id: 'anvil.context-retention.v2';
  version: '2.0.0';
  decisionContract: ProfileIdentity;
  observationABIVersion: 'anvil.semantic-observation-abi.v2';
  predicates: readonly RegisteredSemanticPredicateV2[];
  programDigest: string;
}

export type SemanticRequestValidationResultV2 =
  | { ok: true }
  | { ok: false; code: string; detail: string };

export type SemanticObservationResultV2 =
  | { kind: 'OBSERVATIONS'; observations: SemanticCandidateObservationV2[] }
  | { kind: 'PRISTINE_FALLBACK'; code: string; detail: string };

const PROGRAM_DEFINITIONS: Record<ModeledSemanticAxisV2, string> = {
  evidence_sufficient:
    'The bounded source view and shared state are sufficient to judge the registered retention predicates for this exact candidate and active mission.',
  still_needed:
    'The source-bound candidate carries information likely needed for the active mission.',
  full_content_needed:
    'Replacing omitted source content with an exact reversible reference would materially reduce usefulness.',
  unresolved_evidence:
    'The candidate contains evidence that merits review because of an unresolved failure, warning, dependency, verification gap, or contradiction. Missing evidence alone does not establish this predicate.',
};

const REQUEST_KEYS = [
  'schema',
  'request_id',
  'source_run_id',
  'decision_contract',
  'semantic_program',
  'execution_profile',
  'calibration_profile',
  'policy_profile',
  'shared_conversation_state',
  'candidate_views',
] as const;
const PROFILE_KEYS = ['id', 'version', 'digest'] as const;
const RESPONSE_KEYS = ['schema', 'request_id', 'observations'] as const;
const OBSERVATION_KEYS = [
  'candidate_id',
  ...MODELED_SEMANTIC_AXES_V2,
] as const;
const AXIS_KEYS = ['noul'] as const;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length &&
    actual.every((key) => expected.includes(key));
}

function validateProfile(
  value: unknown,
  field: string,
): SemanticRequestValidationResultV2 {
  if (!isObject(value) || !exactKeys(value, PROFILE_KEYS)) {
    return {
      ok: false,
      code: 'invalid_profile_identity',
      detail: `${field} must contain exactly id, version, digest`,
    };
  }
  if (
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.version !== 'string' ||
    value.version.length === 0
  ) {
    return {
      ok: false,
      code: 'invalid_profile_identity',
      detail: `${field} id/version must be non-empty strings`,
    };
  }
  if (typeof value.digest !== 'string' || !DIGEST.test(value.digest)) {
    return {
      ok: false,
      code: 'invalid_profile_digest',
      detail: `${field}.digest must be canonical sha256`,
    };
  }
  return { ok: true };
}

function validAxis(value: unknown): value is NoulObservation {
  return isObject(value) &&
    exactKeys(value, AXIS_KEYS) &&
    typeof value.noul === 'number' &&
    Number.isFinite(value.noul) &&
    value.noul >= 0 &&
    value.noul <= 1;
}

function frozenIdentity(identity: ProfileIdentity): Readonly<ProfileIdentity> {
  return Object.freeze({
    id: identity.id,
    version: identity.version,
    digest: identity.digest,
  });
}

export function compileContextRetentionProgramV2(
  decisionContract: ProfileIdentity,
): Readonly<RegisteredSemanticProgramV2> {
  const predicates = Object.freeze(
    MODELED_SEMANTIC_AXES_V2.map((id) =>
      Object.freeze({
        id,
        requiresEvidenceSufficient: id !== 'evidence_sufficient',
        semanticDefinition: PROGRAM_DEFINITIONS[id],
      })),
  );
  const contract = frozenIdentity(decisionContract);
  const core = {
    schema: 'anvil.registered-semantic-program.v2' as const,
    id: 'anvil.context-retention.v2' as const,
    version: '2.0.0' as const,
    decisionContract: contract,
    observationABIVersion: 'anvil.semantic-observation-abi.v2' as const,
    predicates,
  };
  return Object.freeze({
    ...core,
    programDigest: sha256Digest(JSON.stringify(core)),
  });
}

export function validateSemanticDecisionRequestV2(
  value: unknown,
): SemanticRequestValidationResultV2 {
  if (!isObject(value) || !exactKeys(value, REQUEST_KEYS)) {
    return {
      ok: false,
      code: 'invalid_request_schema',
      detail: 'semantic request has unexpected or missing top-level fields',
    };
  }
  if (value.schema !== SEMANTIC_DECISION_REQUEST_SCHEMA_V2) {
    return {
      ok: false,
      code: 'invalid_request_schema',
      detail: `schema must be ${SEMANTIC_DECISION_REQUEST_SCHEMA_V2}`,
    };
  }

  const semanticProgram = validateProfile(
    value.semantic_program,
    'semantic_program',
  );
  if (!semanticProgram.ok) return semanticProgram;

  const legacyCompatible = {
    schema: MAPPED_DECISION_REQUEST_SCHEMA,
    request_id: value.request_id,
    source_run_id: value.source_run_id,
    decision_contract: value.decision_contract,
    execution_profile: value.execution_profile,
    calibration_profile: value.calibration_profile,
    policy_profile: value.policy_profile,
    shared_conversation_state: value.shared_conversation_state,
    candidate_views: value.candidate_views,
  };
  const legacy = validateMappedDecisionRequest(legacyCompatible);
  if (!legacy.ok) {
    return {
      ok: false,
      code: legacy.code,
      detail: legacy.detail,
    };
  }
  return { ok: true };
}

export function reassembleSemanticObservationsV2(
  requestID: string,
  candidateIDs: readonly string[],
  payload: unknown,
): SemanticObservationResultV2 {
  const fallback = (
    code: string,
    detail: string,
  ): SemanticObservationResultV2 => ({
    kind: 'PRISTINE_FALLBACK',
    code,
    detail,
  });

  if (!isObject(payload) || !exactKeys(payload, RESPONSE_KEYS)) {
    return fallback(
      'malformed_response',
      'provider response has unexpected or missing top-level fields',
    );
  }
  if (payload.schema !== SEMANTIC_DECISION_RESPONSE_SCHEMA_V2) {
    return fallback('malformed_response', 'provider response schema mismatch');
  }
  if (payload.request_id !== requestID) {
    return fallback(
      'request_id_mismatch',
      'provider response request_id does not match request',
    );
  }
  if (!Array.isArray(payload.observations)) {
    return fallback(
      'malformed_response',
      'provider response observations must be an array',
    );
  }

  const expected = new Set(candidateIDs);
  if (expected.size !== candidateIDs.length) {
    return fallback(
      'duplicate_candidate_id',
      'expected candidate id list contains duplicates',
    );
  }
  if (payload.observations.length !== candidateIDs.length) {
    return fallback(
      'cardinality_mismatch',
      'provider response must contain exactly one observation per candidate',
    );
  }

  const byID = new Map<string, SemanticCandidateObservationV2>();
  for (let index = 0; index < payload.observations.length; index += 1) {
    const raw = payload.observations[index];
    if (!isObject(raw) || !exactKeys(raw, OBSERVATION_KEYS)) {
      return fallback(
        'malformed_observation',
        `observation[${index}] has unexpected or missing fields`,
      );
    }
    if (
      typeof raw.candidate_id !== 'string' ||
      !expected.has(raw.candidate_id)
    ) {
      return fallback(
        'candidate_id_mismatch',
        `observation[${index}] candidate_id is not registered`,
      );
    }
    if (byID.has(raw.candidate_id)) {
      return fallback(
        'duplicate_candidate_id',
        `observation candidate_id ${raw.candidate_id} appears more than once`,
      );
    }

    for (const axis of MODELED_SEMANTIC_AXES_V2) {
      if (!validAxis(raw[axis])) {
        return fallback(
          'malformed_observation',
          `observation[${index}].${axis} must contain only a finite noul in [0,1]`,
        );
      }
    }

    byID.set(raw.candidate_id, {
      candidate_id: raw.candidate_id,
      evidence_sufficient: raw.evidence_sufficient as NoulObservation,
      still_needed: raw.still_needed as NoulObservation,
      full_content_needed: raw.full_content_needed as NoulObservation,
      unresolved_evidence: raw.unresolved_evidence as NoulObservation,
    });
  }

  const ordered = candidateIDs.map((candidateID) => {
    const observation = byID.get(candidateID);
    if (observation === undefined) {
      throw new Error('internal reassembly invariant failure');
    }
    return observation;
  });

  return { kind: 'OBSERVATIONS', observations: ordered };
}
