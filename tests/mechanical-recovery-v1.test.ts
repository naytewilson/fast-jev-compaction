import { describe, expect, it } from 'vitest';
import {
  MechanicalRecoveryAttestor,
  verifyMechanicalRecoveryAttestation,
} from '../src/lab/mechanical-recovery-v1.js';
import {
  InMemoryCAS,
  createToolRecoveryManifest,
  encodeToolEvidence,
} from '../src/lab/recovery.js';

function fixture(put = true) {
  const stdout = 'head\ncritical\ntail';
  const stderr = '';
  const exitStatus = 0;
  const manifest = createToolRecoveryManifest(
    stdout,
    stderr,
    exitStatus,
    'recovery-v2-object',
  );
  const cas = new InMemoryCAS();
  if (put) {
    cas.put(
      'recovery-v2-object',
      encodeToolEvidence(stdout, stderr, exitStatus),
    );
  }
  return {
    stdout,
    stderr,
    exitStatus,
    manifest,
    cas,
    expected: {
      candidateId: 'cand-0001',
      sourceDigest: manifest.source_digest,
    },
  };
}

describe('MechanicalRecoveryAttestor', () => {
  it('issues VERIFIED only from an actual CAS verification', () => {
    const f = fixture(true);
    const attestation = new MechanicalRecoveryAttestor().attestTool({
      candidateId: f.expected.candidateId,
      manifest: f.manifest,
      stdout: f.stdout,
      stderr: f.stderr,
      exitStatus: f.exitStatus,
    }, f.cas);

    expect(attestation.status).toBe('VERIFIED');
    expect(Object.isFrozen(attestation)).toBe(true);
    expect(verifyMechanicalRecoveryAttestation(
      f.expected,
      attestation,
      f.cas.snapshotDigest(),
    )).toEqual({ ok: true });
  });

  it('cannot be forged by copying a VERIFIED-looking object', () => {
    const f = fixture(true);
    const issued = new MechanicalRecoveryAttestor().attestTool({
      candidateId: f.expected.candidateId,
      manifest: f.manifest,
      stdout: f.stdout,
      stderr: f.stderr,
      exitStatus: f.exitStatus,
    }, f.cas);

    expect(verifyMechanicalRecoveryAttestation(
      f.expected,
      { ...issued },
      f.cas.snapshotDigest(),
    )).toMatchObject({
      ok: false,
      code: 'unissued_recovery_attestation',
    });
  });

  it('binds the attestation to the exact CAS snapshot', () => {
    const f = fixture(true);
    const issued = new MechanicalRecoveryAttestor().attestTool({
      candidateId: f.expected.candidateId,
      manifest: f.manifest,
      stdout: f.stdout,
      stderr: f.stderr,
      exitStatus: f.exitStatus,
    }, f.cas);

    f.cas.put('unrelated-object', 'new-state');

    expect(verifyMechanicalRecoveryAttestation(
      f.expected,
      issued,
      f.cas.snapshotDigest(),
    )).toMatchObject({
      ok: false,
      code: 'stale_recovery_snapshot',
    });
  });

  it('records missing objects without granting recovery authority', () => {
    const f = fixture(false);
    const issued = new MechanicalRecoveryAttestor().attestTool({
      candidateId: f.expected.candidateId,
      manifest: f.manifest,
      stdout: f.stdout,
      stderr: f.stderr,
      exitStatus: f.exitStatus,
    }, f.cas);

    expect(issued.status).toBe('MISSING_OBJECT');
    expect(verifyMechanicalRecoveryAttestation(
      f.expected,
      issued,
      f.cas.snapshotDigest(),
    )).toEqual({ ok: true });
  });

  it('records candidate mismatch mechanically', () => {
    const f = fixture(true);
    const issued = new MechanicalRecoveryAttestor().attestTool({
      candidateId: f.expected.candidateId,
      manifest: f.manifest,
      stdout: f.stdout + '\nchanged',
      stderr: f.stderr,
      exitStatus: f.exitStatus,
    }, f.cas);

    expect(issued.status).toBe('CANDIDATE_MISMATCH');
  });
});
