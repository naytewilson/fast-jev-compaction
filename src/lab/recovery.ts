import { createHash } from 'node:crypto';

export interface RecoveryManifest {
  source_digest: string;
  recovery_ref: string;
  byte_count: number;
}

export type RecoveryVerification =
  | { ok: true }
  | {
      ok: false;
      code: 'missing_object' | 'digest_mismatch' | 'byte_count_mismatch' | 'candidate_mismatch';
      detail: string;
    };

function bytesOf(value: Uint8Array | string): Uint8Array {
  return typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
}

export function sha256Digest(value: Uint8Array | string): string {
  return 'sha256:' + createHash('sha256').update(bytesOf(value)).digest('hex');
}

export function encodeToolEvidence(stdout: string, stderr: string, exitStatus: number): string {
  if (!Number.isInteger(exitStatus)) {
    throw new TypeError('exitStatus must be an integer');
  }
  return JSON.stringify({
    schema: 'anvil.tool-evidence.v0',
    stdout,
    stderr,
    exit_status: exitStatus,
  });
}

export function createRecoveryManifest(value: Uint8Array | string, objectID: string): RecoveryManifest {
  const bytes = bytesOf(value);
  return {
    source_digest: sha256Digest(bytes),
    recovery_ref: `cas:${objectID}`,
    byte_count: bytes.byteLength,
  };
}

export function createToolRecoveryManifest(
  stdout: string,
  stderr: string,
  exitStatus: number,
  objectID: string,
): RecoveryManifest {
  return createRecoveryManifest(encodeToolEvidence(stdout, stderr, exitStatus), objectID);
}

export function verifyRecoveryObject(
  manifest: RecoveryManifest,
  value: Uint8Array | string | undefined,
): RecoveryVerification {
  if (value === undefined) {
    return { ok: false, code: 'missing_object', detail: `missing ${manifest.recovery_ref}` };
  }
  const bytes = bytesOf(value);
  if (bytes.byteLength !== manifest.byte_count) {
    return {
      ok: false,
      code: 'byte_count_mismatch',
      detail: `expected ${manifest.byte_count} bytes, got ${bytes.byteLength}`,
    };
  }
  const actual = sha256Digest(bytes);
  if (actual !== manifest.source_digest) {
    return {
      ok: false,
      code: 'digest_mismatch',
      detail: `expected ${manifest.source_digest}, got ${actual}`,
    };
  }
  return { ok: true };
}

export function verifyToolRecoveryObject(
  manifest: RecoveryManifest,
  stdout: string,
  stderr: string,
  exitStatus: number,
  storedValue: Uint8Array | string | undefined,
): RecoveryVerification {
  const canonical = encodeToolEvidence(stdout, stderr, exitStatus);
  const expectedDigest = sha256Digest(canonical);
  const expectedBytes = Buffer.byteLength(canonical, 'utf8');

  if (manifest.source_digest !== expectedDigest || manifest.byte_count !== expectedBytes) {
    return {
      ok: false,
      code: 'candidate_mismatch',
      detail: 'candidate fields do not match the recovery manifest identity',
    };
  }

  return verifyRecoveryObject(manifest, storedValue);
}

export class InMemoryCAS {
  private readonly objects = new Map<string, Uint8Array>();

  put(objectID: string, value: Uint8Array | string): void {
    this.objects.set(objectID, Buffer.from(bytesOf(value)));
  }

  get(objectID: string): Uint8Array | undefined {
    const value = this.objects.get(objectID);
    return value ? Buffer.from(value) : undefined;
  }

  verify(manifest: RecoveryManifest): RecoveryVerification {
    if (!manifest.recovery_ref.startsWith('cas:')) {
      return { ok: false, code: 'missing_object', detail: 'recovery_ref is not CAS-bound' };
    }
    const objectID = manifest.recovery_ref.slice(4);
    return verifyRecoveryObject(manifest, this.get(objectID));
  }

  verifyTool(
    manifest: RecoveryManifest,
    stdout: string,
    stderr: string,
    exitStatus: number,
  ): RecoveryVerification {
    if (!manifest.recovery_ref.startsWith('cas:')) {
      return { ok: false, code: 'missing_object', detail: 'recovery_ref is not CAS-bound' };
    }
    const objectID = manifest.recovery_ref.slice(4);
    return verifyToolRecoveryObject(
      manifest,
      stdout,
      stderr,
      exitStatus,
      this.get(objectID),
    );
  }

  snapshotDigest(): string {
    const entries = [...this.objects.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, bytes]) => [id, sha256Digest(bytes)] as const);
    return sha256Digest(JSON.stringify(entries));
  }
}
