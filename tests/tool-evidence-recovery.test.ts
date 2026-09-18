import { describe, expect, it } from 'vitest';
import { exportedFunction, exportedValue } from './lab-test-helpers.js';

describe('tool evidence recovery binding', () => {
  it('binds stdout, stderr, and exit status into one canonical evidence identity', () => {
    const encode = exportedFunction('encodeToolEvidence');
    const create = exportedFunction('createToolRecoveryManifest');

    const baseline = create('out', 'warn', 7, 'obj-tool');
    expect(baseline.source_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(baseline.byte_count).toBe(Buffer.byteLength(encode('out', 'warn', 7), 'utf8'));

    expect(create('out', 'different', 7, 'obj-tool').source_digest).not.toBe(baseline.source_digest);
    expect(create('out', 'warn', 8, 'obj-tool').source_digest).not.toBe(baseline.source_digest);
  });

  it('verifies both the candidate fields and the stored CAS object', () => {
    const CAS = exportedValue('InMemoryCAS');
    const encode = exportedFunction('encodeToolEvidence');
    const create = exportedFunction('createToolRecoveryManifest');
    const cas = new CAS();

    const manifest = create('stdout', 'stderr', 2, 'obj-bound');
    cas.put('obj-bound', encode('stdout', 'stderr', 2));

    expect(cas.verifyTool(manifest, 'stdout', 'stderr', 2)).toEqual({ ok: true });
    expect(cas.verifyTool(manifest, 'stdout', 'changed-stderr', 2)).toMatchObject({
      ok: false,
      code: 'candidate_mismatch',
    });
    expect(cas.verifyTool(manifest, 'stdout', 'stderr', 3)).toMatchObject({
      ok: false,
      code: 'candidate_mismatch',
    });
  });

  it('rejects a stdout-only CAS object even when stdout itself matches', () => {
    const CAS = exportedValue('InMemoryCAS');
    const create = exportedFunction('createToolRecoveryManifest');
    const cas = new CAS();
    const manifest = create('stdout', 'stderr', 0, 'obj-incomplete');
    cas.put('obj-incomplete', 'stdout');

    expect(cas.verifyTool(manifest, 'stdout', 'stderr', 0)).toMatchObject({ ok: false });
  });
});
