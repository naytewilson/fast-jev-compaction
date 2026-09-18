import { sha256Digest } from './recovery.js';
import { SEMANTIC_OBSERVATION_ABI_DIGEST_V2 } from './semantic-contract-v2.js';
import { deriveSemanticPolicyProfileV2 } from './semantic-policy-profile-v2.js';
import {
  SEMANTIC_POLICY_REASONS_V2,
  type ObservationPolicyThresholdsV2,
  type SemanticPolicyDecisionV2,
  type SemanticPolicyReasonV2,
} from './semantic-policy-v2.js';

export interface CalibratedPolicyReceiptV2Input {
  traceId: string;
  sourceRunId: string;
  providerProfileDigest: string;
  observationABIDigest: string;
  compiledProgramDigest: string;
  calibrationIdentity: string;
  calibrationArtifactDigest: string;
  decisionContractDigest: string;
  policyProfileId: string;
  policyProfileVersion: string;
  policyProfileDigest: string;
  policySemanticsDigest: string;
  rawReplayReceiptDigest: string;
  rawObservationDigest: string;
  calibratedObservationDigest: string;
  thresholds: ObservationPolicyThresholdsV2;
  decisions: readonly SemanticPolicyDecisionV2[];
}

export interface CalibratedPolicyReceiptV2
  extends Omit<CalibratedPolicyReceiptV2Input, 'thresholds' | 'decisions'> {
  schema: 'anvil.calibrated-policy-receipt.v2';
  thresholds: Readonly<ObservationPolicyThresholdsV2>;
  thresholdDigest: string;
  decisions: readonly Readonly<SemanticPolicyDecisionV2>[];
  decisionSetDigest: string;
  receiptId: string;
  receiptDigest: string;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const DISPOSITIONS = new Set([
  'ABSTAIN',
  'FULL',
  'REFERENTIAL',
  'EVICTED',
]);
const REASONS = new Set<SemanticPolicyReasonV2>(
  SEMANTIC_POLICY_REASONS_V2,
);
const RECOVERY_CODES = new Set([
  'missing_object',
  'digest_mismatch',
  'byte_count_mismatch',
  'candidate_mismatch',
  'unissued_recovery_evidence',
  'recovery_identity_mismatch',
  'invalid_recovery_evidence',
  'stale_recovery_snapshot',
]);

const RECEIPT_KEYS = [
  'schema',
  'traceId',
  'sourceRunId',
  'providerProfileDigest',
  'observationABIDigest',
  'compiledProgramDigest',
  'calibrationIdentity',
  'calibrationArtifactDigest',
  'decisionContractDigest',
  'policyProfileId',
  'policyProfileVersion',
  'policyProfileDigest',
  'policySemanticsDigest',
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

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length &&
    actual.every((key) => expected.includes(key));
}

function requireText(value: string, field: string): void {
  if (value.length === 0 || value.includes('\0')) {
    throw new TypeError(field + ' must be non-empty and NUL-free');
  }
}

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) {
    throw new TypeError(field + ' must be canonical sha256');
  }
}

function requireProbability(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(field + ' must be finite in [0,1]');
  }
}

function cloneThresholds(
  thresholds: ObservationPolicyThresholdsV2,
): Readonly<ObservationPolicyThresholdsV2> {
  requireProbability(
    thresholds.evidenceSufficientFloor,
    'evidenceSufficientFloor',
  );
  requireProbability(thresholds.retain, 'retain');
  requireProbability(thresholds.keepFull, 'keepFull');
  requireProbability(thresholds.reviewFloor, 'reviewFloor');
  return Object.freeze({
    evidenceSufficientFloor: thresholds.evidenceSufficientFloor,
    retain: thresholds.retain,
    keepFull: thresholds.keepFull,
    reviewFloor: thresholds.reviewFloor,
  });
}

function validateDecision(
  item: SemanticPolicyDecisionV2,
): Readonly<SemanticPolicyDecisionV2> {
  requireText(item.candidate_id, 'candidate_id');
  requireDigest(item.source_digest, 'source_digest');
  if (!DISPOSITIONS.has(item.disposition)) {
    throw new TypeError('decision disposition is not registered');
  }
  if (!REASONS.has(item.reason)) {
    throw new TypeError('decision reason is not registered');
  }
  if (typeof item.semantic_authority_used !== 'boolean') {
    throw new TypeError('semantic authority flag is malformed');
  }
  if (typeof item.review_advisory !== 'boolean') {
    throw new TypeError('review advisory flag is malformed');
  }
  if (
    item.mechanical_recovery_status !== 'VERIFIED' &&
    item.mechanical_recovery_status !== 'UNAVAILABLE'
  ) {
    throw new TypeError('mechanical recovery status is malformed');
  }
  if (
    item.recovery_failure_code !== null &&
    !RECOVERY_CODES.has(item.recovery_failure_code)
  ) {
    throw new TypeError('recovery failure code is not registered');
  }
  if (
    item.mechanical_recovery_status === 'VERIFIED' &&
    item.recovery_failure_code !== null
  ) {
    throw new Error('verified mechanical recovery cannot carry a recovery failure');
  }
  if (
    item.mechanical_recovery_status === 'UNAVAILABLE' &&
    item.recovery_failure_code === null
  ) {
    throw new Error('unavailable mechanical recovery requires a recovery failure code');
  }
  requireDigest(
    item.mechanical_recovery_evidence_digest,
    'mechanical_recovery_evidence_digest',
  );
  return Object.freeze({ ...item });
}

function canonical(value: unknown): string {
  return JSON.stringify(value);
}

function buildCore(input: CalibratedPolicyReceiptV2Input) {
  requireText(input.traceId, 'traceId');
  requireText(input.sourceRunId, 'sourceRunId');
  for (const [field, value] of [
    ['providerProfileDigest', input.providerProfileDigest],
    ['observationABIDigest', input.observationABIDigest],
    ['compiledProgramDigest', input.compiledProgramDigest],
    ['calibrationIdentity', input.calibrationIdentity],
    ['calibrationArtifactDigest', input.calibrationArtifactDigest],
    ['decisionContractDigest', input.decisionContractDigest],
    ['policyProfileDigest', input.policyProfileDigest],
    ['policySemanticsDigest', input.policySemanticsDigest],
    ['rawReplayReceiptDigest', input.rawReplayReceiptDigest],
    ['rawObservationDigest', input.rawObservationDigest],
    ['calibratedObservationDigest', input.calibratedObservationDigest],
  ] as const) {
    requireDigest(value, field);
  }

  if (input.observationABIDigest !== SEMANTIC_OBSERVATION_ABI_DIGEST_V2) {
    throw new Error('calibrated V2 receipt Observation ABI digest mismatch');
  }
  requireText(input.policyProfileId, 'policyProfileId');
  requireText(input.policyProfileVersion, 'policyProfileVersion');

  const thresholds = cloneThresholds(input.thresholds);
  const derivedPolicy = deriveSemanticPolicyProfileV2({
    id: input.policyProfileId,
    version: input.policyProfileVersion,
    thresholds,
  });
  if (input.policyProfileDigest !== derivedPolicy.policyProfileDigest) {
    throw new Error('calibrated V2 receipt policy profile digest mismatch');
  }
  if (input.policySemanticsDigest !== derivedPolicy.policySemanticsDigest) {
    throw new Error('calibrated V2 receipt policy semantics digest mismatch');
  }
  const thresholdDigest = derivedPolicy.thresholdDigest;

  const decisions = Object.freeze(input.decisions.map(validateDecision));
  const seen = new Set<string>();
  for (const item of decisions) {
    if (seen.has(item.candidate_id)) {
      throw new Error(
        'duplicate policy decision candidate ' + item.candidate_id,
      );
    }
    seen.add(item.candidate_id);
  }
  const decisionSetDigest = sha256Digest(canonical({
    schema: 'anvil.semantic-policy-decision-set.v2',
    decisions,
  }));

  return {
    schema: 'anvil.calibrated-policy-receipt.v2' as const,
    traceId: input.traceId,
    sourceRunId: input.sourceRunId,
    providerProfileDigest: input.providerProfileDigest,
    observationABIDigest: input.observationABIDigest,
    compiledProgramDigest: input.compiledProgramDigest,
    calibrationIdentity: input.calibrationIdentity,
    calibrationArtifactDigest: input.calibrationArtifactDigest,
    decisionContractDigest: input.decisionContractDigest,
    policyProfileId: input.policyProfileId,
    policyProfileVersion: input.policyProfileVersion,
    policyProfileDigest: input.policyProfileDigest,
    policySemanticsDigest: input.policySemanticsDigest,
    rawReplayReceiptDigest: input.rawReplayReceiptDigest,
    rawObservationDigest: input.rawObservationDigest,
    calibratedObservationDigest: input.calibratedObservationDigest,
    thresholds,
    thresholdDigest,
    decisions,
    decisionSetDigest,
  };
}

export function createCalibratedPolicyReceiptV2(
  input: CalibratedPolicyReceiptV2Input,
): Readonly<CalibratedPolicyReceiptV2> {
  const core = buildCore(input);
  const identity = sha256Digest(canonical(core));
  const receiptId =
    'cpr2-' + identity.slice('sha256:'.length, 'sha256:'.length + 24);
  const receiptDigest = sha256Digest(canonical({
    ...core,
    receiptId,
  }));
  return Object.freeze({
    ...core,
    receiptId,
    receiptDigest,
  });
}

export function verifyCalibratedPolicyReceiptV2(
  value: unknown,
): value is CalibratedPolicyReceiptV2 {
  try {
    if (!isObject(value) || !exactKeys(value, RECEIPT_KEYS)) return false;
    if (value.schema !== 'anvil.calibrated-policy-receipt.v2') return false;

    const receipt = value as unknown as CalibratedPolicyReceiptV2;
    if (
      typeof receipt.receiptId !== 'string' ||
      typeof receipt.receiptDigest !== 'string'
    ) return false;

    const core = buildCore({
      traceId: receipt.traceId,
      sourceRunId: receipt.sourceRunId,
      providerProfileDigest: receipt.providerProfileDigest,
      observationABIDigest: receipt.observationABIDigest,
      compiledProgramDigest: receipt.compiledProgramDigest,
      calibrationIdentity: receipt.calibrationIdentity,
      calibrationArtifactDigest: receipt.calibrationArtifactDigest,
      decisionContractDigest: receipt.decisionContractDigest,
      policyProfileId: receipt.policyProfileId,
      policyProfileVersion: receipt.policyProfileVersion,
      policyProfileDigest: receipt.policyProfileDigest,
      policySemanticsDigest: receipt.policySemanticsDigest,
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
      'cpr2-' + identity.slice('sha256:'.length, 'sha256:'.length + 24);
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
