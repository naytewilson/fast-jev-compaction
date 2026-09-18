import { describe, expect, it } from 'vitest';
import { exportedFunction, exportedValue } from './lab-test-helpers.js';

describe('exact recovery manifest and CAS', () => {
  it('creates stable sha256 identities and byte counts', () => {
    const create = exportedFunction('createRecoveryManifest');
    const first = create('abc', 'obj-1');
    const second = create('abc', 'obj-1');
    expect(first).toEqual(second);
    expect(first.source_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.byte_count).toBe(3);
    expect(first.recovery_ref).toBe('cas:obj-1');
  });

  it('verifies exact bytes and rejects one-byte mutation', () => {
    const create = exportedFunction('createRecoveryManifest');
    const verify = exportedFunction('verifyRecoveryObject');
    const manifest = create('critical evidence', 'obj-2');
    expect(verify(manifest, 'critical evidence')).toEqual({ ok: true });
    expect(verify(manifest, 'critical evidencf')).toMatchObject({ ok: false });
  });

  it('fails closed when the object is missing', () => {
    const create = exportedFunction('createRecoveryManifest');
    const verify = exportedFunction('verifyRecoveryObject');
    expect(verify(create('x', 'obj-3'), undefined)).toMatchObject({
      ok: false,
      code: 'missing_object',
    });
  });

  it('does not let another object id satisfy a manifest', () => {
    const CAS = exportedValue('InMemoryCAS');
    expect(typeof CAS).toBe('function');
    const create = exportedFunction('createRecoveryManifest');
    const cas = new CAS();
    cas.put('obj-a', 'same bytes');
    const wrong = create('same bytes', 'obj-b');
    expect(cas.verify(wrong)).toMatchObject({ ok: false, code: 'missing_object' });
  });

  it('detects tampered bytes in CAS', () => {
    const CAS = exportedValue('InMemoryCAS');
    const create = exportedFunction('createRecoveryManifest');
    const cas = new CAS();
    cas.put('obj-c', 'tampered');
    expect(cas.verify(create('expected', 'obj-c'))).toMatchObject({
      ok: false,
      code: 'digest_mismatch',
    });
  });
});
