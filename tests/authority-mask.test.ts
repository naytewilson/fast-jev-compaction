import { describe, expect, it } from 'vitest';
import {
  assertAuthorityPreservingAcceleration,
  deriveSemanticCapabilities,
  isAuthorityPreservingAcceleration,
} from '../src/lab/authority-mask.js';

describe('Semantic Authority Mask Algebra', () => {
  it('separates observation, semantic, policy, and referential capabilities', () => {
    expect(deriveSemanticCapabilities({
      source: true,
      evidence: true,
      calibration: false,
      authority: false,
      recovery: true,
    })).toEqual({
      mayObserve: true,
      mayScoreSemantics: true,
      mayDrivePolicy: false,
      mayPresentReferentially: false,
    });
  });

  it('requires mechanical recovery in addition to policy authority for referential presentation', () => {
    expect(deriveSemanticCapabilities({
      source: true,
      evidence: true,
      calibration: true,
      authority: true,
      recovery: false,
    }).mayPresentReferentially).toBe(false);
  });

  it('allows an acceleration layer to preserve or reduce mask authority', () => {
    const before = {
      source: true,
      evidence: true,
      calibration: true,
      authority: true,
      recovery: true,
    };
    expect(isAuthorityPreservingAcceleration(before, {
      ...before,
      evidence: false,
      authority: false,
    })).toBe(true);
  });

  it('rejects any false-to-true mask transition by an acceleration layer', () => {
    const before = {
      source: true,
      evidence: true,
      calibration: false,
      authority: false,
      recovery: true,
    };
    const after = { ...before, calibration: true };

    expect(isAuthorityPreservingAcceleration(before, after)).toBe(false);
    expect(() => assertAuthorityPreservingAcceleration(before, after))
      .toThrow(/widen authority/i);
  });
});
