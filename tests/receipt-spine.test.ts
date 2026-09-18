import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AUTHORITY_POLICY_OUTCOMES,
  FileReceiptSpineJournal,
  GENESIS_AUTHORITY_RECEIPT_DIGEST,
  ReceiptEnrichmentQueue,
  verifyAuthorityReceiptSpine,
  type AuthorityPolicyOutcome,
} from '../src/lab/receipt-spine.js';
import { sha256Digest } from '../src/lab/recovery.js';

const dirs: string[] = [];
const digest = (c: string) => 'sha256:' + c.repeat(64);

function journalPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'anvil-spine-'));
  dirs.push(dir);
  return join(dir, 'authority.jsonl');
}

function input(policyOutcome: AuthorityPolicyOutcome = 'authorized') {
  return {
    requestId: 'req-1',
    sourceDigest: digest('1'),
    decisionContractDigest: digest('2'),
    compiledProgramDigest: digest('3'),
    observationDigest: digest('4'),
    calibrationIdentity: digest('5'),
    requestedAuthorityIdentity: digest('6'),
    effectiveAuthorityIdentity: digest('7'),
    authorityRoute: 'primary',
    authorityGeneration: 9,
    policyOutcome,
    timestamp: '2026-09-18T00:00:00.000Z',
  };
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('durable authority receipt spine v2', () => {
  it('hash-chains every receipt from a canonical genesis digest', () => {
    const journal = new FileReceiptSpineJournal(journalPath());
    const a = journal.append(input());
    const b = journal.append({ ...input('fallback'), requestId: 'req-2' });
    const c = journal.append({ ...input('suppressed'), requestId: 'req-3' });

    expect(a.previousReceiptDigest).toBe(GENESIS_AUTHORITY_RECEIPT_DIGEST);
    expect(b.previousReceiptDigest).toBe(a.receiptDigest);
    expect(c.previousReceiptDigest).toBe(b.receiptDigest);
    expect(a.receiptSchema).toBe('anvil.authority-receipt-spine.v2');
    expect(verifyAuthorityReceiptSpine(c)).toBe(true);
  });

  it('detects a rewritten middle receipt because the next link no longer matches', () => {
    const path = journalPath();
    const journal = new FileReceiptSpineJournal(path);
    journal.append(input());
    journal.append({ ...input('fallback'), requestId: 'req-2' });
    journal.append({ ...input('suppressed'), requestId: 'req-3' });

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    const middle = JSON.parse(lines[1]);
    middle.policyOutcome = 'abstain';
    const { receiptDigest: _oldDigest, ...withoutDigest } = middle;
    middle.receiptDigest = sha256Digest(JSON.stringify(withoutDigest));
    lines[1] = JSON.stringify(middle);
    writeFileSync(path, lines.join('\n') + '\n');

    expect(() => new FileReceiptSpineJournal(path)).toThrow(/previous_receipt_digest_mismatch/i);
  });

  it('uses a closed policy-outcome vocabulary', () => {
    expect(AUTHORITY_POLICY_OUTCOMES).toEqual([
      'authorized',
      'suppressed',
      'hydrate',
      'fallback',
      'escalate',
      'abstain',
      'unoptimized',
    ]);
    expect(() => new FileReceiptSpineJournal(journalPath()).append({
      ...input(),
      policyOutcome: 'invented' as AuthorityPolicyOutcome,
    })).toThrow(/policyOutcome/i);
  });

  it('rejects malformed self-consistent-looking receipts', () => {
    const journal = new FileReceiptSpineJournal(journalPath());
    const receipt = journal.append(input());
    expect(verifyAuthorityReceiptSpine({
      ...receipt,
      receiptSchema: 'anvil.authority-receipt-spine.v1',
    } as any)).toBe(false);
    expect(verifyAuthorityReceiptSpine({
      ...receipt,
      sequence: 0,
    } as any)).toBe(false);
    expect(verifyAuthorityReceiptSpine({
      ...receipt,
      sourceDigest: 'sha256:BAD',
    } as any)).toBe(false);
  });
});

describe('bounded async enrichment queue', () => {
  it('evicts the oldest lowest-priority item for higher-priority calibration evidence', () => {
    const queue = new ReceiptEnrichmentQueue(3);
    queue.enqueue({ id: 'debug-old', priority: 'P3', payload: 'd1' });
    queue.enqueue({ id: 'telemetry', priority: 'P2', payload: 't' });
    queue.enqueue({ id: 'debug-new', priority: 'P3', payload: 'd2' });

    const result = queue.enqueue({ id: 'cal', priority: 'P1', payload: 'c' });

    expect(result).toEqual({ accepted: true, evictedId: 'debug-old' });
    expect(queue.snapshot().map((x) => x.id)).toEqual(['telemetry', 'debug-new', 'cal']);
  });

  it('never displaces P1 evidence for lower-priority enrichment', () => {
    const queue = new ReceiptEnrichmentQueue(2);
    queue.enqueue({ id: 'cal-a', priority: 'P1', payload: 'a' });
    queue.enqueue({ id: 'cal-b', priority: 'P1', payload: 'b' });

    expect(queue.enqueue({ id: 'debug', priority: 'P3', payload: 'x' }))
      .toEqual({ accepted: false });
    expect(queue.snapshot().map((x) => x.id)).toEqual(['cal-a', 'cal-b']);
  });
});
