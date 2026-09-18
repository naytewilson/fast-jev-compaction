import {
  MAPPED_DECISION_REQUEST_SCHEMA,
  type MappedRequestValidationResult,
} from './types.js';

const TOP_LEVEL_KEYS = [
  'schema',
  'request_id',
  'source_run_id',
  'decision_contract',
  'execution_profile',
  'calibration_profile',
  'policy_profile',
  'shared_conversation_state',
  'candidate_views',
] as const;

const IDENTITY_KEYS = ['id', 'version', 'digest'] as const;
const SHARED_STATE_KEYS = [
  'mission',
  'recent_turns',
  'active_constraints',
  'unresolved_failures',
  'source_refs',
] as const;
const CANDIDATE_KEYS = [
  'candidate_id',
  'source_digest',
  'source_kind',
  'recovery_ref',
  'byte_count',
  'hard_roots',
  'semantic_view',
] as const;
const HARD_ROOT_KEYS = ['exit_status', 'stderr', 'first_lines', 'last_lines'] as const;
const SEMANTIC_VIEW_KEYS = ['head', 'tail', 'selected_chunks', 'omitted_bytes'] as const;

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const CANDIDATE_ID = /^cand-[A-Za-z0-9._-]{1,96}$/;
const CAS_REF = /^cas:[A-Za-z0-9._:-]+$/;

function fail(code: string, detail: string): MappedRequestValidationResult {
  return { ok: false, code, detail };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(object: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(object);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function validateIdentity(value: unknown, field: string): MappedRequestValidationResult {
  if (!isObject(value) || !exactKeys(value, IDENTITY_KEYS)) {
    return fail('invalid_profile_identity', `${field} must contain exactly id, version, digest`);
  }
  if (!nonEmptyString(value.id) || !nonEmptyString(value.version)) {
    return fail('invalid_profile_identity', `${field} id/version must be non-empty strings`);
  }
  if (typeof value.digest !== 'string' || !DIGEST.test(value.digest)) {
    return fail('invalid_profile_digest', `${field}.digest must be canonical sha256`);
  }
  return { ok: true };
}

function validateSharedState(value: unknown): MappedRequestValidationResult {
  if (!isObject(value) || !exactKeys(value, SHARED_STATE_KEYS)) {
    return fail('invalid_shared_state', 'shared_conversation_state has unexpected or missing fields');
  }
  if (!nonEmptyString(value.mission)) {
    return fail('invalid_shared_state', 'shared_conversation_state.mission must be non-empty');
  }
  for (const key of ['recent_turns', 'active_constraints', 'unresolved_failures', 'source_refs'] as const) {
    if (!stringArray(value[key])) {
      return fail('invalid_shared_state', `shared_conversation_state.${key} must be an array of strings`);
    }
  }
  return { ok: true };
}

function validateCandidate(value: unknown, index: number): MappedRequestValidationResult {
  if (!isObject(value) || !exactKeys(value, CANDIDATE_KEYS)) {
    return fail('invalid_candidate_schema', `candidate_views[${index}] has unexpected or missing fields`);
  }
  if (typeof value.candidate_id !== 'string' || !CANDIDATE_ID.test(value.candidate_id)) {
    return fail('invalid_candidate_id', `candidate_views[${index}].candidate_id is malformed`);
  }
  if (typeof value.source_digest !== 'string' || !DIGEST.test(value.source_digest)) {
    return fail('invalid_source_digest', `candidate_views[${index}].source_digest is malformed`);
  }
  if (value.source_kind !== 'tool_result') {
    return fail('invalid_source_kind', `candidate_views[${index}].source_kind must be tool_result`);
  }
  if (typeof value.recovery_ref !== 'string' || !CAS_REF.test(value.recovery_ref)) {
    return fail('invalid_recovery_ref', `candidate_views[${index}].recovery_ref must be a CAS identity`);
  }
  if (!nonNegativeInteger(value.byte_count)) {
    return fail('invalid_byte_count', `candidate_views[${index}].byte_count must be a non-negative integer`);
  }

  if (!isObject(value.hard_roots) || !exactKeys(value.hard_roots, HARD_ROOT_KEYS)) {
    return fail('invalid_hard_roots', `candidate_views[${index}].hard_roots has unexpected or missing fields`);
  }
  if (!Number.isInteger(value.hard_roots.exit_status)) {
    return fail('invalid_hard_roots', `candidate_views[${index}].hard_roots.exit_status must be an integer`);
  }
  for (const key of ['stderr', 'first_lines', 'last_lines'] as const) {
    if (!stringArray(value.hard_roots[key])) {
      return fail('invalid_hard_roots', `candidate_views[${index}].hard_roots.${key} must be string[]`);
    }
  }

  if (!isObject(value.semantic_view) || !exactKeys(value.semantic_view, SEMANTIC_VIEW_KEYS)) {
    return fail('invalid_semantic_view', `candidate_views[${index}].semantic_view has unexpected or missing fields`);
  }
  if (typeof value.semantic_view.head !== 'string' || typeof value.semantic_view.tail !== 'string') {
    return fail('invalid_semantic_view', `candidate_views[${index}].semantic_view head/tail must be strings`);
  }
  if (!stringArray(value.semantic_view.selected_chunks)) {
    return fail('invalid_semantic_view', `candidate_views[${index}].semantic_view.selected_chunks must be string[]`);
  }
  if (!nonNegativeInteger(value.semantic_view.omitted_bytes)) {
    return fail('invalid_semantic_view', `candidate_views[${index}].semantic_view.omitted_bytes must be non-negative`);
  }

  return { ok: true };
}

export function validateMappedDecisionRequest(value: unknown): MappedRequestValidationResult {
  if (!isObject(value) || !exactKeys(value, TOP_LEVEL_KEYS)) {
    return fail('invalid_request_schema', 'mapped request has unexpected or missing top-level fields');
  }
  if (value.schema !== MAPPED_DECISION_REQUEST_SCHEMA) {
    return fail('invalid_request_schema', `schema must be ${MAPPED_DECISION_REQUEST_SCHEMA}`);
  }
  if (!nonEmptyString(value.request_id) || !nonEmptyString(value.source_run_id)) {
    return fail('invalid_request_identity', 'request_id and source_run_id must be non-empty strings');
  }

  for (const key of [
    'decision_contract',
    'execution_profile',
    'calibration_profile',
    'policy_profile',
  ] as const) {
    const result = validateIdentity(value[key], key);
    if (!result.ok) return result;
  }

  const shared = validateSharedState(value.shared_conversation_state);
  if (!shared.ok) return shared;

  if (!Array.isArray(value.candidate_views) || value.candidate_views.length < 1 || value.candidate_views.length > 64) {
    return fail('invalid_candidate_count', 'candidate_views length must be 1..64');
  }

  const seen = new Set<string>();
  let previous = '';
  for (let index = 0; index < value.candidate_views.length; index += 1) {
    const result = validateCandidate(value.candidate_views[index], index);
    if (!result.ok) return result;
    const candidate = value.candidate_views[index] as Record<string, unknown>;
    const id = candidate.candidate_id as string;
    if (seen.has(id)) {
      return fail('duplicate_candidate_id', `candidate_id ${id} appears more than once`);
    }
    if (index > 0 && previous >= id) {
      return fail('candidate_order', 'candidate_views must be in strict lexical candidate_id order');
    }
    seen.add(id);
    previous = id;
  }

  return { ok: true };
}
