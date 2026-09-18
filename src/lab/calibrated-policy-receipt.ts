import { sha256Digest } from './recovery.js';
import {
  SEMANTIC_POLICY_REASONS,
  type SemanticPolicyDecision,
  type SemanticPolicyReason,
} from './semantic-policy.js';
import type { ObservationPolicyThresholds } from './observation-arm.js';

export interface CalibratedPolicyReceiptInput {
  traceId: string;
  sourceRunId: string;
  providerProfileDigest: string;
  calibrationIdentity: string;
  calibrationArtifactDigest: string;
  decisionContractDigest: string;
  policyProfileDigest: string;
  rawReplayReceiptDigest: string;
  rawObservationDigest: string;
  calibratedObservationDigest: string;
  thresholds: ObservationPolicyThresholds;
  decisions: readonly SemanticPolicyDecision[];
}

export interface CalibratedPolicyReceipt
  extends Omit<CalibratedPolicyReceiptInput, 'thresholds' | 'decisions'> {
  schema: 'anvil.calibrated-policy-receipt.v1';
  thresholds: Readonly<ObservationPolicyThresholds>;
  thresholdDigest: string;
  decisions: readonly Readonly<SemanticPolicyDecision>[];
  decisionSetDigest: string;
  receiptId: string;
  receiptDigest: string;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const DISPOSITIONS = new Set(['ABSTAIN', 'FULL', 'REFERENTIAL', 'EVICTED']);
const REASONS = new Set<SemanticPolicyReason>(SEMANTIC_POLICY_REASONS);
const RECOVERY_CODES = new Set([
  'missing_object',
  'digest_mismatch',
  'byte_count_mismatch',
  'candidate_mismatch',
]);

const RECEIPT_KEYS = [
  'schema',
  'traceId',
  'sourceRunId',
  'providerProfileDigest',
  'calibrationIdentity',
  'calibrationArtifactDigest',
  'decisionContractDigest',
  'policyProfileDigest',
  'rawReplayReceiptDigest',
  'rawObservationDigest',
  'calibratedObservationDigest',
  'thresholds',
  'thresholdDigest',
  'decisions',
  'decisionSetDigest',
  'receiptId',
  'receiptDigest',
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function requireText(value: string, field: string): void {
  if (value.length === 0 || value.includes('\0')) {
    throw new TypeError(`${field} must be non-empty and NUL-free`);
  }
}

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) {
    throw new TypeError(`${field} must be canonical sha256`);
  }
}

function requireProbability(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${field} must be finite in [0,1]`);
  }
}

function cloneThresholds(
  thresholds: ObservationPolicyThresholds,
): Readonly<ObservationPolicyThresholds> {
  requireProbability(
    thresholds.evidenceSufficientFloor,
    'evidenceSufficientFloor',
  );
  requireProbability(thresholds.keepFull, 'keepFull');
  requireProbability(thresholds.retain, 'retain');
  return Object.freeze({ ...thresholds });
}

function validateDecision(
  decision: SemanticPolicyDecision,
): Readonly<SemanticPolicyDecision> {
  requireText(decision.candidateId, 'candidateId');
  requireDigest(decision.sourceDigest, 'sourceDigest');
  if (!DISPOSITIONS.has(decision.disposition)) {
    throw new TypeError('decision disposition is not registered');
  }
  if (!REASONS.has(decision.reason)) {
    throw new TypeError('decision reason is not registered');
  }
  if (
    decision.mechanicalRecoveryVerified !== true &&
    decision.mechanicalRecoveryVerified !== false &&
    decision.mechanicalRecoveryVerified !== null
  ) {
    throw new TypeError('mechanical recovery state is malformed');
  }
  if (
    decision.recoveryFailureCode !== null &&
    !RECOVERY_CODES.has(decision.recoveryFailureCode)
  ) {
    throw new TypeError('recovery failure code is not registered');
  }
  if (
    decision.mechanicalRecoveryVerified === true &&
    decision.recoveryFailureCode !== null
  ) {
    throw new Error('verified mechanical recovery cannot carry a recovery failure');
  }
  if (
    decision.mechanicalRecoveryVerified === false &&
    decision.recoveryFailureCode === null
  ) {
    throw new Error('failed mechanical recovery requires a recovery failure code');
  }
  if (
    decision.mechanicalRecoveryVerified === null &&
    decision.recoveryFailureCode !== null
  ) {
    throw new Error('unchecked mechanical recovery cannot carry a recovery failure');
  }

  return Object.freeze({ ...decision });
}

function canonical(value: unknown): string {
  return JSON.stringify(value);
}

function buildCore(input: CalibratedPolicyReceiptInput) {
  requireText(input.traceId, 'traceId');
  requireText(input.sourceRunId, 'sourceRunId');
  for (const [field, value] of [
    ['providerProfileDigest', input.providerProfileDigest],
    ['calibrationIdentity', input.calibrationIdentity],
    ['calibrationArtifactDigest', input.calibrationArtifactDigest],
    ['decisionContractDigest', input.decisionContractDigest],
    ['policyProfileDigest', input.policyProfileDigest],
    ['rawReplayReceiptDigest', input.rawReplayReceiptDigest],
    ['rawObservationDigest', input.rawObservationDigest],
    ['calibratedObservationDigest', input.calibratedObservationDigest],
  ] as const) {
    requireDigest(value, field);
  }

  const thresholds = cloneThresholds(input.thresholds);
  const thresholdDigest = sha256Digest(canonical({
    schema: 'anvil.semantic-policy-thresholds.v1',
    ...thresholds,
  }));

  const decisions = Object.freeze(input.decisions.map(validateDecision));
  const seen = new Set<string>();
  for (const item of decisions) {
    if (seen.has(item.candidateId)) {
      throw new Error(`duplicate policy decision candidate ${item.candidateId}`);
    }
    seen.add(item.candidateId);
  }
  const decisionSetDigest = sha256Digest(canonical({
    schema: 'anvil.semantic-policy-decision-set.v1',
    decisions,
  }));

  return {
    schema: 'anvil.calibrated-policy-receipt.v1' as const,
    traceId: input.traceId,
    sourceRunId: input.sourceRunId,
    providerProfileDigest: input.providerProfileDigest,
    calibrationIdentity: input.calibrationIdentity,
    calibrationArtifactDigest: input.calibrationArtifactDigest,
    decisionContractDigest: input.decisionContractDigest,
    policyProfileDigest: input.policyProfileDigest,
    rawReplayReceiptDigest: input.rawReplayReceiptDigest,
    rawObservationDigest: input.rawObservationDigest,
    calibratedObservationDigest: input.calibratedObservationDigest,
    thresholds,
    thresholdDigest,
    decisions,
    decisionSetDigest,
  };
}

export function createCalibratedPolicyReceipt(
  input: CalibratedPolicyReceiptInput,
): Readonly<CalibratedPolicyReceipt> {
  const core = buildCore(input);
  const identity = sha256Digest(canonical(core));
  const receiptId =
    `cpr-${identity.slice('sha256:'.length, 'sha256:'.length + 24)}`;
  const receiptDigest = sha256Digest(canonical({ ...core, receiptId }));
  return Object.freeze({ ...core, receiptId, receiptDigest });
}

export function verifyCalibratedPolicyReceipt(
  value: unknown,
): value is CalibratedPolicyReceipt {
  try {
    if (!isObject(value) || !exactKeys(value, RECEIPT_KEYS)) return false;
    if (value.schema !== 'anvil.calibrated-policy-receipt.v1') return false;

    const receipt = value as unknown as CalibratedPolicyReceipt;
    if (
      typeof receipt.receiptId !== 'string' ||
      typeof receipt.receiptDigest !== 'string'
    ) return false;

    const core = buildCore({
      traceId: receipt.traceId,
      sourceRunId: receipt.sourceRunId,
      providerProfileDigest: receipt.providerProfileDigest,
      calibrationIdentity: receipt.calibrationIdentity,
      calibrationArtifactDigest: receipt.calibrationArtifactDigest,
      decisionContractDigest: receipt.decisionContractDigest,
      policyProfileDigest: receipt.policyProfileDigest,
      rawReplayReceiptDigest: receipt.rawReplayReceiptDigest,
      rawObservationDigest: receipt.rawObservationDigest,
      calibratedObservationDigest: receipt.calibratedObservationDigest,
      thresholds: receipt.thresholds,
      decisions: receipt.decisions,
    });

    if (
      core.thresholdDigest !== receipt.thresholdDigest ||
      core.decisionSetDigest !== receipt.decisionSetDigest
    ) return false;

    const identity = sha256Digest(canonical(core));
    const expectedId =
      `cpr-${identity.slice('sha256:'.length, 'sha256:'.length + 24)}`;
    const expectedDigest = sha256Digest(canonical({
      ...core,
      receiptId: receipt.receiptId,
    }));
    return (
      receipt.receiptId === expectedId &&
      receipt.receiptDigest === expectedDigest
    );
  } catch {
    return false;
  }
}
