import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  writeSync,
} from 'node:fs';
import { sha256Digest } from './recovery.js';

export const AUTHORITY_POLICY_OUTCOMES = [
  'authorized',
  'suppressed',
  'hydrate',
  'fallback',
  'escalate',
  'abstain',
  'unoptimized',
] as const;

export type AuthorityPolicyOutcome = (typeof AUTHORITY_POLICY_OUTCOMES)[number];

export const AUTHORITY_RECEIPT_ROUTES = [
  'primary',
  'hydrate',
  'pristine',
  'compatible-profile',
  'alternate-provider',
  'unoptimized',
] as const;

export type AuthorityReceiptRoute = (typeof AUTHORITY_RECEIPT_ROUTES)[number];

export const GENESIS_AUTHORITY_RECEIPT_DIGEST =
  sha256Digest('ANVIL.AuthorityReceiptSpine.Genesis.v2');

export interface AuthorityReceiptSpineInput {
  requestId: string;
  sourceDigest: string;
  decisionContractDigest: string;
  compiledProgramDigest: string;
  observationDigest: string;
  calibrationIdentity: string;
  requestedAuthorityIdentity: string | null;
  effectiveAuthorityIdentity: string | null;
  authorityRoute: AuthorityReceiptRoute;
  authorityGeneration: number;
  policyOutcome: AuthorityPolicyOutcome;
  timestamp: string;
}

export interface AuthorityReceiptSpine extends AuthorityReceiptSpineInput {
  receiptSchema: 'anvil.authority-receipt-spine.v2';
  receiptId: string;
  sequence: number;
  previousReceiptDigest: string;
  receiptDigest: string;
}

type ReceiptCore = Omit<AuthorityReceiptSpine, 'receiptId' | 'receiptDigest'>;

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RECEIPT_KEYS = [
  'receiptSchema',
  'receiptId',
  'sequence',
  'previousReceiptDigest',
  'requestId',
  'sourceDigest',
  'decisionContractDigest',
  'compiledProgramDigest',
  'observationDigest',
  'calibrationIdentity',
  'requestedAuthorityIdentity',
  'effectiveAuthorityIdentity',
  'authorityRoute',
  'authorityGeneration',
  'policyOutcome',
  'timestamp',
  'receiptDigest',
] as const;

function canonical(value: unknown): string {
  return JSON.stringify(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function requireDigest(value: string | null, field: string, nullable = false): void {
  if (value === null && nullable) return;
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    throw new TypeError(`${field} must be canonical sha256${nullable ? ' or null' : ''}`);
  }
}

function validateInput(input: AuthorityReceiptSpineInput): void {
  if (input.requestId.length === 0 || input.requestId.includes('\0')) {
    throw new TypeError('requestId must be non-empty and NUL-free');
  }
  requireDigest(input.sourceDigest, 'sourceDigest');
  requireDigest(input.decisionContractDigest, 'decisionContractDigest');
  requireDigest(input.compiledProgramDigest, 'compiledProgramDigest');
  requireDigest(input.observationDigest, 'observationDigest');
  requireDigest(input.calibrationIdentity, 'calibrationIdentity');
  requireDigest(input.requestedAuthorityIdentity, 'requestedAuthorityIdentity', true);
  requireDigest(input.effectiveAuthorityIdentity, 'effectiveAuthorityIdentity', true);

  if (!AUTHORITY_RECEIPT_ROUTES.includes(input.authorityRoute)) {
    throw new TypeError('authorityRoute is not registered');
  }
  if (!AUTHORITY_POLICY_OUTCOMES.includes(input.policyOutcome)) {
    throw new TypeError('policyOutcome is not registered');
  }
  if (!Number.isSafeInteger(input.authorityGeneration) || input.authorityGeneration < 0) {
    throw new TypeError('authorityGeneration must be a non-negative safe integer');
  }
  const parsed = new Date(input.timestamp);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== input.timestamp) {
    throw new TypeError('timestamp must be canonical ISO-8601');
  }
}

function buildReceipt(
  input: AuthorityReceiptSpineInput,
  sequence: number,
  previousReceiptDigest: string,
): AuthorityReceiptSpine {
  validateInput(input);
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new TypeError('receipt sequence must be a positive safe integer');
  }
  requireDigest(previousReceiptDigest, 'previousReceiptDigest');

  const core: ReceiptCore = {
    receiptSchema: 'anvil.authority-receipt-spine.v2',
    sequence,
    previousReceiptDigest,
    requestId: input.requestId,
    sourceDigest: input.sourceDigest,
    decisionContractDigest: input.decisionContractDigest,
    compiledProgramDigest: input.compiledProgramDigest,
    observationDigest: input.observationDigest,
    calibrationIdentity: input.calibrationIdentity,
    requestedAuthorityIdentity: input.requestedAuthorityIdentity,
    effectiveAuthorityIdentity: input.effectiveAuthorityIdentity,
    authorityRoute: input.authorityRoute,
    authorityGeneration: input.authorityGeneration,
    policyOutcome: input.policyOutcome,
    timestamp: input.timestamp,
  };
  const identity = sha256Digest(canonical(core));
  const receiptId = `ars-${identity.slice('sha256:'.length, 'sha256:'.length + 24)}`;
  const receiptDigest = sha256Digest(canonical({ ...core, receiptId }));
  return Object.freeze({ ...core, receiptId, receiptDigest });
}

export function verifyAuthorityReceiptSpine(value: unknown): value is AuthorityReceiptSpine {
  try {
    if (!isObject(value) || !exactKeys(value, RECEIPT_KEYS)) return false;
    const receipt = value as unknown as AuthorityReceiptSpine;
    if (receipt.receiptSchema !== 'anvil.authority-receipt-spine.v2') return false;
    if (!Number.isSafeInteger(receipt.sequence) || receipt.sequence <= 0) return false;
    requireDigest(receipt.previousReceiptDigest, 'previousReceiptDigest');
    validateInput(receipt);
    if (typeof receipt.receiptId !== 'string' || typeof receipt.receiptDigest !== 'string') {
      return false;
    }

    const {
      receiptId,
      receiptDigest,
      ...core
    } = receipt;
    const identity = sha256Digest(canonical(core));
    const expectedID = `ars-${identity.slice('sha256:'.length, 'sha256:'.length + 24)}`;
    const expectedDigest = sha256Digest(canonical({ ...core, receiptId }));
    return receiptId === expectedID && receiptDigest === expectedDigest;
  } catch {
    return false;
  }
}

export class FileReceiptSpineJournal {
  private nextSequence: number;
  private tailDigest: string;

  constructor(private readonly path: string) {
    const existing = this.readAll();
    this.nextSequence = existing.length + 1;
    this.tailDigest =
      existing.length === 0
        ? GENESIS_AUTHORITY_RECEIPT_DIGEST
        : existing[existing.length - 1].receiptDigest;
  }

  append(input: AuthorityReceiptSpineInput): AuthorityReceiptSpine {
    const receipt = buildReceipt(input, this.nextSequence, this.tailDigest);
    const line = canonical(receipt) + '\n';
    const fd = openSync(this.path, 'a', 0o600);
    try {
      writeSync(fd, line);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.nextSequence += 1;
    this.tailDigest = receipt.receiptDigest;
    return receipt;
  }

  headDigest(): string {
    return this.tailDigest;
  }

  readAll(): AuthorityReceiptSpine[] {
    if (!existsSync(this.path)) return [];
    const raw = readFileSync(this.path, 'utf8');
    if (raw.length === 0) return [];

    const lines = raw.split('\n').filter((line) => line.length > 0);
    const parsed: unknown[] = lines.map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`receipt_parse_failure at line ${index + 1}`);
      }
    });

    let previousDigest = GENESIS_AUTHORITY_RECEIPT_DIGEST;
    for (let index = 0; index < parsed.length; index += 1) {
      const rawReceipt = parsed[index];
      if (!isObject(rawReceipt)) {
        throw new Error(`receipt_schema_invalid at line ${index + 1}`);
      }
      const expectedSequence = index + 1;
      if (rawReceipt.sequence !== expectedSequence) {
        throw new Error(
          `receipt_sequence_gap: expected ${expectedSequence}, got ${String(rawReceipt.sequence)}`,
        );
      }
      if (rawReceipt.previousReceiptDigest !== previousDigest) {
        throw new Error(
          `previous_receipt_digest_mismatch at sequence ${expectedSequence}`,
        );
      }
      if (typeof rawReceipt.receiptDigest !== 'string') {
        throw new Error(`receipt_digest_missing at sequence ${expectedSequence}`);
      }
      previousDigest = rawReceipt.receiptDigest;
    }

    return parsed.map((rawReceipt, index) => {
      if (!verifyAuthorityReceiptSpine(rawReceipt)) {
        throw new Error(`receipt_digest_mismatch at sequence ${index + 1}`);
      }
      return Object.freeze({ ...rawReceipt });
    });
  }
}

export type EnrichmentPriority = 'P1' | 'P2' | 'P3';

export interface ReceiptEnrichment {
  id: string;
  priority: EnrichmentPriority;
  payload: unknown;
}

export type EnrichmentEnqueueResult =
  | { accepted: true; evictedId?: string }
  | { accepted: false };

interface QueuedEnrichment extends ReceiptEnrichment {
  insertion: number;
}

const PRIORITY: Record<EnrichmentPriority, number> = {
  P1: 3,
  P2: 2,
  P3: 1,
};

export class ReceiptEnrichmentQueue {
  private readonly items: QueuedEnrichment[] = [];
  private insertion = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new TypeError('enrichment queue capacity must be a positive safe integer');
    }
  }

  enqueue(item: ReceiptEnrichment): EnrichmentEnqueueResult {
    if (item.id.length === 0) throw new TypeError('enrichment id must be non-empty');
    const queued: QueuedEnrichment = {
      ...item,
      insertion: this.insertion++,
    };

    if (this.items.length < this.capacity) {
      this.items.push(queued);
      return { accepted: true };
    }

    const incomingRank = PRIORITY[item.priority];
    let victimIndex = -1;
    let victimRank = Number.POSITIVE_INFINITY;
    let victimInsertion = Number.POSITIVE_INFINITY;

    for (let index = 0; index < this.items.length; index += 1) {
      const candidate = this.items[index];
      const rank = PRIORITY[candidate.priority];
      if (
        rank < incomingRank &&
        (rank < victimRank || (rank === victimRank && candidate.insertion < victimInsertion))
      ) {
        victimIndex = index;
        victimRank = rank;
        victimInsertion = candidate.insertion;
      }
    }

    if (victimIndex < 0) return { accepted: false };

    const [evicted] = this.items.splice(victimIndex, 1);
    this.items.push(queued);
    return { accepted: true, evictedId: evicted.id };
  }

  snapshot(): readonly ReceiptEnrichment[] {
    return Object.freeze(
      this.items.map(({ insertion: _insertion, ...item }) => Object.freeze({ ...item })),
    );
  }
}
