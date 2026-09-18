import { sha256Digest } from './recovery.js';

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
}

export interface ReplayReceipt extends ReplayReceiptInput {
  receipt_digest: string;
}

function canonicalReceiptPayload(input: ReplayReceiptInput): string {
  return JSON.stringify({
    receipt_schema: input.receipt_schema,
    trace_id: input.trace_id,
    source_run_id: input.source_run_id,
    arm: input.arm,
    decision_contract_digest: input.decision_contract_digest,
    execution_profile_digest: input.execution_profile_digest,
    calibration_profile_digest: input.calibration_profile_digest,
    policy_profile_digest: input.policy_profile_digest,
    candidate_set_digest: input.candidate_set_digest,
    observation_set_digest: input.observation_set_digest,
    dispositions: input.dispositions,
  });
}

export function createReplayReceipt(input: ReplayReceiptInput): ReplayReceipt {
  return {
    ...input,
    receipt_digest: sha256Digest(canonicalReceiptPayload(input)),
  };
}

export function verifyReplayReceipt(receipt: ReplayReceipt): boolean {
  const { receipt_digest, ...input } = receipt;
  return receipt_digest === sha256Digest(canonicalReceiptPayload(input));
}
