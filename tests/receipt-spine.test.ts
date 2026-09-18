import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileReceiptSpineJournal,
  ReceiptEnrichmentQueue,
  verifyAuthorityReceiptSpine,
} from '../src/lab/receipt-spine.js';

const dirs: string[] = [];
const digest = (c: string) => 'sha256:' + c.repeat(64);

function journalPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'anvil-spine-'));
  dirs.push(dir);
  return join(dir, 'authority.jsonl');
}

function input(policyOutcome = 'authorized') {
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

describe('durable authority receipt spine', () => {
  it('persists monotonic verified spines across journal reopen', () => {
    const path = journalPath();
    const journal = new FileReceiptSpineJournal(path);
    const a = journal.append(input());
    const b = journal.append({ ...input('fallback'), requestId: 'req-2' });

    expect(a.sequence).toBe(1);
    expect(b.sequence).toBe(2);
    expect(verifyAuthorityReceiptSpine(a)).toBe(true);
    expect(verifyAuthorityReceiptSpine(b)).toBe(true);

    const reopened = new FileReceiptSpineJournal(path);
    expect(reopened.readAll().map((r) => r.sequence)).toEqual([1, 2]);
    expect(reopened.append({ ...input(), requestId: 'req-3' }).sequence).toBe(3);
  });

  it('detects tampering before replaying journal authority', () => {
    const path = journalPath();
    const journal = new FileReceiptSpineJournal(path);
    journal.append(input());

    const raw = readFileSync(path, 'utf8');
    writeFileSync(path, raw.replace('"policyOutcome":"authorized"', '"policyOutcome":"suppressed"'));

    expect(() => new FileReceiptSpineJournal(path)).toThrow(/receipt_digest_mismatch/i);
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
