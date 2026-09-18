import type {
  Digest256,
} from './identity.js';
import type {
  ModelIdentityAssurance,
} from './execution-profile.js';
import { sha256Digest } from './recovery.js';

export type TimingEvidenceKind = 'measured' | 'synthetic';

export interface LatencySummary {
  p50: number;
  p95: number;
  p99: number;
  sampleCount: number;
}

export interface ShapeBucketMeasurement {
  tokenBucket: number;
  batchSize: number;
  sampleCount: number;
  latencyMs: {
    p50: number;
    p95: number;
    p99: number;
  };
  itemsPerSecond: number;
}

export interface LocalHardwareMachineIdentity {
  platform: string;
  arch: string;
  osVersion: string;
  hardwareClass: string;
  accelerator: string;
  backend: string;
  runtimeVersion: string;
}

export interface LocalHardwareReceiptInput {
  repository: string;
  branch: string;
  commitSha: string;
  timestamp: string;
  machine: LocalHardwareMachineIdentity;
  modelIdentityDigest: Digest256;
  modelAssurance: ModelIdentityAssurance;
  executionSemanticsDigest: Digest256;
  timingEvidence: TimingEvidenceKind;
  routeLatencyMs: LatencySummary;
  observerLatencyMs: LatencySummary;
  shapeBuckets: readonly ShapeBucketMeasurement[];
  peakRSSBytes: number | null;
  productionAuthorityGranted: false;
}

export interface LocalHardwareReceipt extends LocalHardwareReceiptInput {
  schema: 'anvil.local-hardware-receipt.v1';
  receiptId: string;
  receiptDigest: Digest256;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SHA40 = /^[0-9a-f]{40}$/;
const ASSURANCE = new Set<ModelIdentityAssurance>([
  'contentVerified',
  'providerAttested',
  'opaqueVersioned',
  'unknown',
]);

function requireText(value: string, field: string): void {
  if (value.length === 0) throw new TypeError(`${field} must be non-empty`);
}

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) throw new TypeError(`${field} must be canonical sha256`);
}

function validatePercentiles(
  value: { p50: number; p95: number; p99: number },
  field: string,
): void {
  for (const [name, number] of Object.entries(value)) {
    if (!Number.isFinite(number) || number < 0) {
      throw new TypeError(`${field} ${name} must be finite and non-negative`);
    }
  }
  if (!(value.p50 <= value.p95 && value.p95 <= value.p99)) {
    throw new TypeError(`${field} percentile ordering must satisfy p50 <= p95 <= p99`);
  }
}

function validateLatency(value: LatencySummary, field: string): void {
  validatePercentiles(value, field);
  if (!Number.isSafeInteger(value.sampleCount) || value.sampleCount <= 0) {
    throw new TypeError(`${field} sampleCount must be a positive safe integer`);
  }
}

function cloneLatency(value: LatencySummary): LatencySummary {
  return Object.freeze({ ...value });
}

function cloneShape(value: ShapeBucketMeasurement): ShapeBucketMeasurement {
  validatePercentiles(value.latencyMs, 'shape latency');
  if (!Number.isSafeInteger(value.tokenBucket) || value.tokenBucket <= 0) {
    throw new TypeError('shape tokenBucket must be a positive safe integer');
  }
  if (!Number.isSafeInteger(value.batchSize) || value.batchSize <= 0) {
    throw new TypeError('shape batchSize must be a positive safe integer');
  }
  if (!Number.isSafeInteger(value.sampleCount) || value.sampleCount <= 0) {
    throw new TypeError('shape sampleCount must be a positive safe integer');
  }
  if (!Number.isFinite(value.itemsPerSecond) || value.itemsPerSecond <= 0) {
    throw new TypeError('shape itemsPerSecond must be finite and positive');
  }
  return Object.freeze({
    tokenBucket: value.tokenBucket,
    batchSize: value.batchSize,
    sampleCount: value.sampleCount,
    latencyMs: Object.freeze({ ...value.latencyMs }),
    itemsPerSecond: value.itemsPerSecond,
  });
}

function validateAndClone(
  input: LocalHardwareReceiptInput,
): Omit<LocalHardwareReceipt, 'receiptId' | 'receiptDigest'> {
  requireText(input.repository, 'repository');
  requireText(input.branch, 'branch');
  if (!SHA40.test(input.commitSha)) throw new TypeError('commitSha must be exact 40-hex sha');
  if (Number.isNaN(Date.parse(input.timestamp))) {
    throw new TypeError('timestamp must be parseable');
  }

  for (const [field, value] of Object.entries(input.machine)) {
    requireText(value, `machine.${field}`);
  }

  requireDigest(input.modelIdentityDigest, 'modelIdentityDigest');
  requireDigest(input.executionSemanticsDigest, 'executionSemanticsDigest');
  if (!ASSURANCE.has(input.modelAssurance)) {
    throw new TypeError('unknown model assurance');
  }
  if (input.timingEvidence !== 'measured' && input.timingEvidence !== 'synthetic') {
    throw new TypeError('timingEvidence must be measured or synthetic');
  }
  if (input.productionAuthorityGranted !== false) {
    throw new Error('local measurement receipt cannot grant production authority');
  }

  validateLatency(input.routeLatencyMs, 'routeLatencyMs');
  validateLatency(input.observerLatencyMs, 'observerLatencyMs');

  if (input.shapeBuckets.length === 0) {
    throw new TypeError('shapeBuckets must not be empty');
  }
  const shapes = input.shapeBuckets.map(cloneShape);

  if (
    input.peakRSSBytes !== null &&
    (!Number.isSafeInteger(input.peakRSSBytes) || input.peakRSSBytes < 0)
  ) {
    throw new TypeError('peakRSSBytes must be null or a non-negative safe integer');
  }

  return Object.freeze({
    schema: 'anvil.local-hardware-receipt.v1' as const,
    repository: input.repository,
    branch: input.branch,
    commitSha: input.commitSha,
    timestamp: input.timestamp,
    machine: Object.freeze({ ...input.machine }),
    modelIdentityDigest: input.modelIdentityDigest,
    modelAssurance: input.modelAssurance,
    executionSemanticsDigest: input.executionSemanticsDigest,
    timingEvidence: input.timingEvidence,
    routeLatencyMs: cloneLatency(input.routeLatencyMs),
    observerLatencyMs: cloneLatency(input.observerLatencyMs),
    shapeBuckets: Object.freeze(shapes),
    peakRSSBytes: input.peakRSSBytes,
    productionAuthorityGranted: false as const,
  });
}

function receiptDigest(
  core: Omit<LocalHardwareReceipt, 'receiptId' | 'receiptDigest'>,
  receiptId: string,
): Digest256 {
  return sha256Digest(JSON.stringify({ ...core, receiptId }));
}

export function createLocalHardwareReceipt(
  input: LocalHardwareReceiptInput,
): Readonly<LocalHardwareReceipt> {
  const core = validateAndClone(input);
  const identity = sha256Digest(JSON.stringify(core));
  const receiptId = `lhr-${identity.slice('sha256:'.length, 'sha256:'.length + 24)}`;
  const digest = receiptDigest(core, receiptId);
  return Object.freeze({ ...core, receiptId, receiptDigest: digest });
}

export function verifyLocalHardwareReceipt(receipt: LocalHardwareReceipt): boolean {
  try {
    const { receiptId, receiptDigest: actualDigest, schema: _schema, ...rest } = receipt;
    const core = validateAndClone(rest as LocalHardwareReceiptInput);
    if (receipt.schema !== 'anvil.local-hardware-receipt.v1') return false;
    const identity = sha256Digest(JSON.stringify(core));
    const expectedId = `lhr-${identity.slice('sha256:'.length, 'sha256:'.length + 24)}`;
    if (receiptId !== expectedId) return false;
    return receiptDigest(core, receiptId) === actualDigest;
  } catch {
    return false;
  }
}
