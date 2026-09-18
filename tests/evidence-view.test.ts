import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { InMemoryEvidenceStore } from '../src/lab/evidence-view.js';

const digest = (value: string) =>
  'sha256:' + createHash('sha256').update(value).digest('hex');

describe('EvidenceSlice resolver', () => {
  it('resolves a source-bound slice through the owning store', () => {
    const store = new InMemoryEvidenceStore(7);
    store.putObject('obj-1', 'abcdef');

    const resolved = store.resolve({
      objectHandle: 'obj-1',
      manifestGeneration: 7,
      sourceDigest: digest('abcdef'),
      offset: 2,
      length: 3,
    });

    expect(Buffer.from(resolved.bytes).toString('utf8')).toBe('cde');
    expect(resolved.sourceDigest).toBe(digest('abcdef'));
    expect(resolved.manifestGeneration).toBe(7);
  });

  it('rejects stale generations before semantic execution', () => {
    const store = new InMemoryEvidenceStore(2);
    store.putObject('obj-1', 'abcdef');

    expect(() => store.resolve({
      objectHandle: 'obj-1',
      manifestGeneration: 1,
      sourceDigest: digest('abcdef'),
      offset: 0,
      length: 1,
    })).toThrow(/stale_generation/);
  });

  it('rejects a caller-supplied digest that does not bind the object bytes', () => {
    const store = new InMemoryEvidenceStore(1);
    store.putObject('obj-1', 'abcdef');

    expect(() => store.resolve({
      objectHandle: 'obj-1',
      manifestGeneration: 1,
      sourceDigest: digest('different'),
      offset: 0,
      length: 1,
    })).toThrow(/digest_mismatch/);
  });

  it('uses overflow-safe bounds checks', () => {
    const store = new InMemoryEvidenceStore(1);
    store.putObject('obj-1', 'abcdef');

    expect(() => store.resolve({
      objectHandle: 'obj-1',
      manifestGeneration: 1,
      sourceDigest: digest('abcdef'),
      offset: 5,
      length: Number.MAX_SAFE_INTEGER,
    })).toThrow(/out_of_bounds/);
  });

  it('rejects missing objects', () => {
    const store = new InMemoryEvidenceStore(1);
    expect(() => store.resolve({
      objectHandle: 'missing',
      manifestGeneration: 1,
      sourceDigest: digest('abcdef'),
      offset: 0,
      length: 1,
    })).toThrow(/missing_object/);
  });
});
