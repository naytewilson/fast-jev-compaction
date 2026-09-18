import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  writeSync,
} from 'node:fs';
import { sha256Digest } from './recovery.js';

export type AuthorityPolicyOutcome =
  | 'authorized'
  | 'suppressed'
  | 'hydrate'
  | 'fallback'
  | 'escalate'
  | 'abstain'
  | 'unoptimized'
  | string;

export interface AuthorityReceiptSpineInput {
  requestId: string;
  sourceDigest: string;
  decisionContractDigest: string;
  compiledProgramDigest: string;
  observationDigest: string;
  calibrationIdentity: string;
  requestedAuthorityIdentity: string;
  effectiveAuthorityIdentity: string;
  authorityRoute: string;
  authorityGeneration: number;
  policyOutcome: AuthorityPolicyOutcome;
  timestamp: string;
}

export interface AuthorityReceiptSpine extends AuthorityReceiptSpineInput {
  receiptSchema: 'anvil.authority-receipt-spine.v1';
  receiptId: string;
  sequence: number;
  receiptDigest: string;
}

type ReceiptCore = Omit<AuthorityReceiptSpine, 'receiptId' | 'receiptDigest'>;

const DIGEST = /^sha256:[0-9a-f]{64}$/;

function canonical(value: unknown): string {
  return JSON.stringify(value);
}

function validateInput(input: AuthorityReceiptSpineInput): void {
  if (input.requestId.length === 0) throw new TypeError('requestId must be non-empty');
  for (const [name, value] of [
    ['sourceDigest', input.sourceDigest],
    ['decisionContractDigest', input.decisionContractDigest],
    ['compiledProgramDigest', input.compiledProgramDigest],
    ['observationDigest', input.observationDigest],
    ['calibrationIdentity', input.calibrationIdentity],
    ['requestedAuthorityIdentity', input.requestedAuthorityIdentity],
    ['effectiveAuthorityIdentity', input.effectiveAuthorityIdentity],
  ] as const) {
    if (!DIGEST.test(value)) throw new TypeError(`${name} must be canonical sha256`);
  }
  if (!Number.isSafeInteger(input.authorityGeneration) || input.authorityGeneration < 0) {
    throw new TypeError('authorityGeneration must be a non-negative safe integer');
  }
  if (input.authorityRoute.length === 0) throw new TypeError('authorityRoute must be non-empty');
  if (String(input.policyOutcome).length === 0) throw new TypeError('policyOutcome must be non-empty');
  if (input.timestamp.length === 0 || Number.isNaN(Date.parse(input.timestamp))) {
    throw new TypeError('timestamp must be an ISO-compatible timestamp');
  }
}

function buildReceipt(input: AuthorityReceiptSpineInput, sequence: number): AuthorityReceiptSpine {
  validateInput(input);
  const core: ReceiptCore = {
    receiptSchema: 'anvil.authority-receipt-spine.v1',
    sequence,
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

export function verifyAuthorityReceiptSpine(receipt: AuthorityReceiptSpine): boolean {
  const { receiptId, receiptDigest, ...core } = receipt;
  const identity = sha256Digest(canonical(core));
  const expectedID = `ars-${identity.slice('sha256:'.length, 'sha256:'.length + 24)}`;
  const expectedDigest = sha256Digest(canonical({ ...core, receiptId }));
  return receiptId === expectedID && receiptDigest === expectedDigest;
}

export class FileReceiptSpineJournal {
  private nextSequence: number;

  constructor(private readonly path: string) {
    const existing = this.readAll();
    this.nextSequence = existing.length + 1;
  }

  append(input: AuthorityReceiptSpineInput): AuthorityReceiptSpine {
    const receipt = buildReceipt(input, this.nextSequence);
    const line = canonical(receipt) + '\n';
    const fd = openSync(this.path, 'a', 0o600);
    try {
      writeSync(fd, line);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.nextSequence += 1;
    return receipt;
  }

  readAll(): AuthorityReceiptSpine[] {
    if (!existsSync(this.path)) return [];
    const raw = readFileSync(this.path, 'utf8');
    if (raw.length === 0) return [];

    const lines = raw.split('\n').filter((line) => line.length > 0);
    const receipts = lines.map((line, index) => {
      let receipt: AuthorityReceiptSpine;
      try {
        receipt = JSON.parse(line) as AuthorityReceiptSpine;
      } catch {
        throw new Error(`receipt_parse_failure at line ${index + 1}`);
      }
      const expectedSequence = index + 1;
      if (receipt.sequence !== expectedSequence) {
        throw new Error(
          `receipt_sequence_gap: expected ${expectedSequence}, got ${receipt.sequence}`,
        );
      }
      if (!verifyAuthorityReceiptSpine(receipt)) {
        throw new Error(`receipt_digest_mismatch at sequence ${expectedSequence}`);
      }
      return Object.freeze({ ...receipt });
    });
    return receipts;
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
