import type { Digest256 } from './identity.js';
import {
  verifyExecutionSemanticsIdentity,
  verifyLocalModelIdentity,
  type ExecutionSemanticsIdentity,
  type LocalModelIdentity,
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
  modelIdentity: LocalModelIdentity;
  executionSemantics: ExecutionSemanticsIdentity;
  timingEvidence: TimingEvidenceKind;
  routeLatencyMs: LatencySummary;
  observerLatencyMs: LatencySummary;
  shapeBuckets: readonly ShapeBucketMeasurement[];
  peakRSSBytes: number | null;
  productionAuthorityGranted: false;
}

export interface LocalHardwareReceipt extends LocalHardwareReceiptInput {
  schema: 'anvil.local-hardware-receipt.v2';
  receiptId: string;
  receiptDigest: Digest256;
}

const SHA40 = /^[0-9a-f]{40}$/;
const RECEIPT_KEYS = [
  'schema',
  'receiptId',
  'receiptDigest',
  'repository',
  'branch',
  'commitSha',
  'timestamp',
  'machine',
  'modelIdentity',
  'executionSemantics',
  'timingEvidence',
  'routeLatencyMs',
  'observerLatencyMs',
  'shapeBuckets',
  'peakRSSBytes',
  'productionAuthorityGranted',
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

function validateShapeOrdering(shapes: readonly ShapeBucketMeasurement[]): void {
  let previous: [number, number] | null = null;
  for (const shape of shapes) {
    const current: [number, number] = [shape.tokenBucket, shape.batchSize];
    if (
      previous !== null &&
      (current[0] < previous[0] ||
        (current[0] === previous[0] && current[1] <= previous[1]))
    ) {
      throw new TypeError(
        'shapeBuckets must be unique and ordered by tokenBucket then batchSize',
      );
    }
    previous = current;
  }
}

function validateAndClone(
  input: LocalHardwareReceiptInput,
): Omit<LocalHardwareReceipt, 'receiptId' | 'receiptDigest'> {
  requireText(input.repository, 'repository');
  requireText(input.branch, 'branch');
  if (!SHA40.test(input.commitSha)) throw new TypeError('commitSha must be exact 40-hex sha');

  const parsed = new Date(input.timestamp);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== input.timestamp) {
    throw new TypeError('timestamp must be canonical ISO-8601');
  }

  for (const [field, value] of Object.entries(input.machine)) {
    requireText(value, `machine.${field}`);
  }

  if (!verifyLocalModelIdentity(input.modelIdentity)) {
    throw new TypeError('modelIdentity is not internally verifiable');
  }
  if (!verifyExecutionSemanticsIdentity(input.executionSemantics)) {
    throw new TypeError('executionSemantics is not internally verifiable');
  }
  if (input.machine.backend !== input.executionSemantics.backend) {
    throw new TypeError('machine backend must match executionSemantics backend');
  }
  if (input.machine.runtimeVersion !== input.executionSemantics.runtimeVersion) {
    throw new TypeError('machine runtimeVersion must match executionSemantics runtimeVersion');
  }
  if (input.modelIdentity.quantization !== input.executionSemantics.quantization) {
    throw new TypeError('model and execution quantization must match');
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
  validateShapeOrdering(shapes);

  if (
    input.peakRSSBytes !== null &&
    (!Number.isSafeInteger(input.peakRSSBytes) || input.peakRSSBytes < 0)
  ) {
    throw new TypeError('peakRSSBytes must be null or a non-negative safe integer');
  }

  return Object.freeze({
    schema: 'anvil.local-hardware-receipt.v2' as const,
    repository: input.repository,
    branch: input.branch,
    commitSha: input.commitSha,
    timestamp: input.timestamp,
    machine: Object.freeze({ ...input.machine }),
    modelIdentity: Object.freeze({ ...input.modelIdentity }),
    executionSemantics: Object.freeze({ ...input.executionSemantics }),
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

export function verifyLocalHardwareReceipt(value: unknown): value is LocalHardwareReceipt {
  try {
    if (!isObject(value) || !exactKeys(value, RECEIPT_KEYS)) return false;
    const receipt = value as unknown as LocalHardwareReceipt;
    if (receipt.schema !== 'anvil.local-hardware-receipt.v2') return false;
    if (typeof receipt.receiptId !== 'string' || typeof receipt.receiptDigest !== 'string') {
      return false;
    }
    const { receiptId, receiptDigest: actualDigest, schema: _schema, ...rest } = receipt;
    const core = validateAndClone(rest as LocalHardwareReceiptInput);
    const identity = sha256Digest(JSON.stringify(core));
    const expectedId = `lhr-${identity.slice('sha256:'.length, 'sha256:'.length + 24)}`;
    return receiptId === expectedId && receiptDigest(core, receiptId) === actualDigest;
  } catch {
    return false;
  }
}
