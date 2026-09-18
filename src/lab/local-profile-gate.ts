import {
  verifyExecutionSemanticsIdentity,
  verifyLocalModelIdentity,
} from './execution-profile.js';
import {
  verifyLocalHardwareReceipt,
  type LocalHardwareReceipt,
  type TimingEvidenceKind,
} from './hardware-receipt.js';

export interface LocalProfileExpected {
  repository: string;
  branch: string;
  commitSha: string;
  platform: string;
  arch: string;
  accelerator: string;
  backend: string;
  timingEvidence: TimingEvidenceKind;
}

export interface LocalProfileGateResult {
  status: 'MEASUREMENT_ACCEPTED_NO_AUTHORITY' | 'REJECTED';
  reasons: string[];
  productionAuthorityGranted: false;
}

export function evaluateLocalProfileReceipt(
  receipt: LocalHardwareReceipt,
  expected: LocalProfileExpected,
): LocalProfileGateResult {
  const reasons: string[] = [];

  if (!verifyLocalHardwareReceipt(receipt)) reasons.push('INVALID_RECEIPT_DIGEST');
  if (receipt.repository !== expected.repository) reasons.push('REPOSITORY_MISMATCH');
  if (receipt.branch !== expected.branch) reasons.push('BRANCH_MISMATCH');
  if (receipt.commitSha !== expected.commitSha) reasons.push('COMMIT_SHA_MISMATCH');
  if (receipt.machine.platform !== expected.platform) reasons.push('PLATFORM_MISMATCH');
  if (receipt.machine.arch !== expected.arch) reasons.push('ARCH_MISMATCH');
  if (receipt.machine.accelerator !== expected.accelerator) reasons.push('ACCELERATOR_MISMATCH');
  if (receipt.machine.backend !== expected.backend) reasons.push('BACKEND_MISMATCH');
  if (receipt.timingEvidence !== expected.timingEvidence) reasons.push('TIMING_EVIDENCE_MISMATCH');
  if (!verifyLocalModelIdentity(receipt.modelIdentity)) reasons.push('MODEL_IDENTITY_INVALID');
  if (receipt.modelIdentity.assurance !== 'contentVerified') {
    reasons.push('MODEL_ASSURANCE_INSUFFICIENT');
  }
  if (!verifyExecutionSemanticsIdentity(receipt.executionSemantics)) {
    reasons.push('EXECUTION_SEMANTICS_INVALID');
  }
  if (receipt.productionAuthorityGranted !== false) reasons.push('AUTHORITY_CLAIM_FORBIDDEN');

  return {
    status:
      reasons.length === 0
        ? 'MEASUREMENT_ACCEPTED_NO_AUTHORITY'
        : 'REJECTED',
    reasons,
    productionAuthorityGranted: false,
  };
}
