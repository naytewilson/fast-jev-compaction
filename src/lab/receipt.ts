import { sha256Digest } from './recovery.js';

export interface ReplayProviderUsage {
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
}

export interface ReplayReceiptInput {
  receipt_schema: string;
  trace_id: string;
  source_run_id: string;
  arm: string;

  decision_contract_digest: string;
  execution_profile_digest: string;
  calibration_profile_digest: string;
  policy_profile_digest: string;
  candidate_set_digest: string;
  observation_set_digest: string;
  dispositions: string[];

  decision_contract_id?: string;
  decision_contract_version?: string;
  execution_profile_id?: string;
  execution_profile_version?: string;
  calibration_profile_id?: string;
  calibration_profile_version?: string;
  policy_profile_id?: string;
  policy_profile_version?: string;

  source_trace_digest?: string;
  shared_state_digest?: string;
  ordered_candidate_ids?: string[];
  provider_request_digest?: string;
  provider_response_digest?: string;
  hard_root_policy_digest?: string;
  recovery_manifest_digest?: string;
  policy_dispositions?: string[];
  provider_model_requested?: string;
  provider_model_effective?: string;
  provider_usage?: ReplayProviderUsage;
  latency_ms?: number | null;
  error_code?: string | null;
  pristine_fallback?: boolean;
}

export interface ReplayReceipt {
  receipt_schema: string;
  receipt_id: string;
  trace_id: string;
  source_trace_digest: string;
  source_run_id: string;
  arm: string;

  decision_contract_id: string;
  decision_contract_version: string;
  decision_contract_digest: string;
  execution_profile_id: string;
  execution_profile_version: string;
  execution_profile_digest: string;
  calibration_profile_id: string;
  calibration_profile_version: string;
  calibration_profile_digest: string;
  policy_profile_id: string;
  policy_profile_version: string;
  policy_profile_digest: string;

  shared_state_digest: string;
  candidate_set_digest: string;
  ordered_candidate_ids: string[];
  provider_request_digest: string;
  provider_response_digest: string;
  observation_set_digest: string;
  hard_root_policy_digest: string;
  recovery_manifest_digest: string;
  policy_dispositions: string[];

  provider_model_requested: string;
  provider_model_effective: string;
  provider_usage: ReplayProviderUsage;
  latency_ms: number | null;
  error_code: string | null;
  pristine_fallback: boolean;

  /** Compatibility alias for early V0 callers. */
  dispositions: string[];
  receipt_digest: string;
}

type ReceiptCore = Omit<ReplayReceipt, 'receipt_id' | 'receipt_digest'>;

const MISSING_DIGEST = sha256Digest('anvil.semantic-retention.missing.v0');

function normalize(input: ReplayReceiptInput): ReceiptCore {
  const policyDispositions = [...(input.policy_dispositions ?? input.dispositions)];
  return {
    receipt_schema: input.receipt_schema,
    trace_id: input.trace_id,
    source_trace_digest: input.source_trace_digest ?? MISSING_DIGEST,
    source_run_id: input.source_run_id,
    arm: input.arm,

    decision_contract_id: input.decision_contract_id ?? 'unspecified',
    decision_contract_version: input.decision_contract_version ?? 'unspecified',
    decision_contract_digest: input.decision_contract_digest,
    execution_profile_id: input.execution_profile_id ?? 'unspecified',
    execution_profile_version: input.execution_profile_version ?? 'unspecified',
    execution_profile_digest: input.execution_profile_digest,
    calibration_profile_id: input.calibration_profile_id ?? 'unspecified',
    calibration_profile_version: input.calibration_profile_version ?? 'unspecified',
    calibration_profile_digest: input.calibration_profile_digest,
    policy_profile_id: input.policy_profile_id ?? 'unspecified',
    policy_profile_version: input.policy_profile_version ?? 'unspecified',
    policy_profile_digest: input.policy_profile_digest,

    shared_state_digest: input.shared_state_digest ?? MISSING_DIGEST,
    candidate_set_digest: input.candidate_set_digest,
    ordered_candidate_ids: [...(input.ordered_candidate_ids ?? [])],
    provider_request_digest: input.provider_request_digest ?? MISSING_DIGEST,
    provider_response_digest: input.provider_response_digest ?? MISSING_DIGEST,
    observation_set_digest: input.observation_set_digest,
    hard_root_policy_digest: input.hard_root_policy_digest ?? MISSING_DIGEST,
    recovery_manifest_digest: input.recovery_manifest_digest ?? MISSING_DIGEST,
    policy_dispositions: policyDispositions,

    provider_model_requested: input.provider_model_requested ?? 'unspecified',
    provider_model_effective: input.provider_model_effective ?? 'unspecified',
    provider_usage: input.provider_usage ?? {
      input_tokens: null,
      output_tokens: null,
      cost_usd: null,
    },
    latency_ms: input.latency_ms ?? null,
    error_code: input.error_code ?? null,
    pristine_fallback: input.pristine_fallback ?? false,

    dispositions: [...input.dispositions],
  };
}

function canonical(value: unknown): string {
  return JSON.stringify(value);
}

export function createReplayReceipt(input: ReplayReceiptInput): ReplayReceipt {
  const core = normalize(input);
  const identityDigest = sha256Digest(canonical(core));
  const receipt_id = `rr-${identityDigest.slice('sha256:'.length, 'sha256:'.length + 24)}`;
  const receipt_digest = sha256Digest(canonical({ ...core, receipt_id }));
  return {
    ...core,
    receipt_id,
    receipt_digest,
  };
}

export function verifyReplayReceipt(receipt: ReplayReceipt): boolean {
  const {
    receipt_id,
    receipt_digest,
    ...core
  } = receipt;
  const identityDigest = sha256Digest(canonical(core));
  const expectedID = `rr-${identityDigest.slice('sha256:'.length, 'sha256:'.length + 24)}`;
  const expectedDigest = sha256Digest(canonical({ ...core, receipt_id }));
  return receipt_id === expectedID && receipt_digest === expectedDigest;
}
