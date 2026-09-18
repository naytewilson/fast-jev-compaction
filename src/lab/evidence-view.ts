import { createHash } from 'node:crypto';
import type { Digest256 } from './identity.js';

export interface EvidenceSlice {
  objectHandle: string;
  manifestGeneration: number;
  sourceDigest: Digest256;
  offset: number;
  length: number;
}

export interface VerifiedEvidenceSlice extends EvidenceSlice {
  objectLength: number;
  pin: string;
  readonly bytes: Uint8Array;
}

export type EvidenceResolutionCode =
  | 'stale_generation'
  | 'missing_object'
  | 'digest_mismatch'
  | 'out_of_bounds';

export class EvidenceResolutionError extends Error {
  constructor(public readonly code: EvidenceResolutionCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'EvidenceResolutionError';
  }
}

function sha256(value: Uint8Array): Digest256 {
  return 'sha256:' + createHash('sha256').update(value).digest('hex');
}

function safeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export class InMemoryEvidenceStore {
  private readonly objects = new Map<string, Uint8Array>();

  constructor(private generation: number) {
    if (!safeInteger(generation)) {
      throw new TypeError('generation must be a non-negative safe integer');
    }
  }

  putObject(handle: string, value: Uint8Array | string): void {
    if (handle.length === 0) throw new TypeError('object handle must be non-empty');
    const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
    const existing = this.objects.get(handle);
    if (existing !== undefined) {
      if (!Buffer.from(existing).equals(Buffer.from(bytes))) {
        throw new Error('immutable_object_conflict: object handle already binds different bytes');
      }
      return;
    }
    this.objects.set(handle, bytes);
  }

  advanceGeneration(): number {
    if (this.generation === Number.MAX_SAFE_INTEGER) {
      throw new RangeError('manifest generation exhausted');
    }
    this.generation += 1;
    return this.generation;
  }

  currentGeneration(): number {
    return this.generation;
  }

  resolve(slice: EvidenceSlice): VerifiedEvidenceSlice {
    if (slice.manifestGeneration !== this.generation) {
      throw new EvidenceResolutionError('stale_generation', 'slice generation is not current');
    }

    const object = this.objects.get(slice.objectHandle);
    if (!object) {
      throw new EvidenceResolutionError('missing_object', slice.objectHandle);
    }

    if (sha256(object) !== slice.sourceDigest) {
      throw new EvidenceResolutionError('digest_mismatch', 'slice digest does not bind object bytes');
    }

    if (!safeInteger(slice.offset) || !safeInteger(slice.length)) {
      throw new EvidenceResolutionError(
        'out_of_bounds',
        'offset/length must be non-negative safe integers',
      );
    }

    if (slice.offset > object.byteLength || slice.length > object.byteLength - slice.offset) {
      throw new EvidenceResolutionError('out_of_bounds', 'slice exceeds object bounds');
    }

    return {
      ...slice,
      objectLength: object.byteLength,
      pin: `${slice.objectHandle}@${this.generation}`,
      bytes: object.subarray(slice.offset, slice.offset + slice.length),
    };
  }
}
