export const MAPPED_DECISION_REQUEST_SCHEMA = 'anvil.mapped-decision-request.v0' as const;
export const MAPPED_DECISION_RESPONSE_SCHEMA = 'anvil.mapped-decision-response.v0' as const;

export const MAPPED_OBSERVATION_AXES = [
  'evidence_sufficient',
  'still_needed',
  'full_content_needed',
  'unresolved_evidence',
  'recoverable',
] as const;

export type MappedObservationAxis = (typeof MAPPED_OBSERVATION_AXES)[number];
export type CandidateID = string;

export interface ProfileIdentity {
  id: string;
  version: string;
  digest: string;
}

export interface MappedHardRoots {
  exit_status: number;
  stderr: string[];
  first_lines: string[];
  last_lines: string[];
}

export interface MappedSemanticView {
  head: string;
  tail: string;
  selected_chunks: string[];
  omitted_bytes: number;
}

export interface MappedCandidateView {
  candidate_id: CandidateID;
  source_digest: string;
  source_kind: 'tool_result';
  recovery_ref: string;
  byte_count: number;
  hard_roots: MappedHardRoots;
  semantic_view: MappedSemanticView;
}

export interface MappedSharedConversationState {
  mission: string;
  recent_turns: string[];
  active_constraints: string[];
  unresolved_failures: string[];
  source_refs: string[];
}

export interface MappedDecisionRequest {
  schema: typeof MAPPED_DECISION_REQUEST_SCHEMA;
  request_id: string;
  source_run_id: string;
  decision_contract: ProfileIdentity;
  execution_profile: ProfileIdentity;
  calibration_profile: ProfileIdentity;
  policy_profile: ProfileIdentity;
  shared_conversation_state: MappedSharedConversationState;
  candidate_views: MappedCandidateView[];
}

export type MappedRequestValidationResult =
  | { ok: true }
  | { ok: false; code: string; detail: string };

export interface NoulObservation {
  noul: number;
}

export interface MappedCandidateObservation {
  candidate_id: CandidateID;
  evidence_sufficient: NoulObservation;
  still_needed: NoulObservation;
  full_content_needed: NoulObservation;
  unresolved_evidence: NoulObservation;
  recoverable: NoulObservation;
}

export interface MappedDecisionResponse {
  schema: typeof MAPPED_DECISION_RESPONSE_SCHEMA;
  request_id: string;
  observations: MappedCandidateObservation[];
}

export interface PristineFallback {
  kind: 'PRISTINE_FALLBACK';
  code: string;
  detail: string;
}

export type MappedObservationResult =
  | { kind: 'OBSERVATIONS'; observations: MappedCandidateObservation[] }
  | PristineFallback;

export interface HardRootInput {
  exitStatus: number;
  stdout: string;
  stderr: string;
  headLines: number;
  tailLines: number;
  presentationBudgetBytes: number;
}

export interface HardRootEligible {
  kind: 'ELIGIBLE';
  hardRoots: MappedHardRoots;
  hardRootBytes: number;
  omitted_stdout_bytes: number;
  retained_stdout_line_indexes: number[];
}

export interface HardRootPristine {
  kind: 'PRISTINE';
  reason: 'hard_roots_exceed_budget';
  exitStatus: number;
  stdout: string;
  stderr: string;
  hardRootBytes: number;
}

export type HardRootResult = HardRootEligible | HardRootPristine;
