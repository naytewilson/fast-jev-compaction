import { describe, expect, it } from 'vitest';
import {
  handoffAuthority,
  selectAuthorityRoute,
  type AuthorityRoutingRequest,
} from '../src/lab/authority-router.js';

const d = (c: string) => 'sha256:' + c.repeat(64);
const mask = (
  source: boolean,
  evidence: boolean,
  calibration: boolean,
  authority: boolean,
  recovery: boolean,
) => ({ source, evidence, calibration, authority, recovery });

function base(): AuthorityRoutingRequest {
  return {
    requestId: 'req-1',
    sourceLineageDigest: d('1'),
    routeGeneration: 7,
    primary: {
      id: 'jev-primary',
      authorityIdentity: d('2'),
      mask: mask(true, true, false, false, true),
    },
    evidenceDeficit: false,
    mechanicalRecoveryAvailable: false,
    pristineAvailable: true,
    compatibleProfiles: [],
    alternateProviders: [],
  };
}

describe('AuthorityRouter', () => {
  it('falls back to pristine when the primary has no policy authority', () => {
    const decision = selectAuthorityRoute(base());
    expect(decision.route).toBe('pristine');
    expect(decision.taskContinues).toBe(true);
    expect(decision.effectiveAuthorityIdentity).toBeNull();
  });

  it('hydrates a recoverable evidence deficit before considering alternate providers', () => {
    const request = base();
    request.evidenceDeficit = true;
    request.mechanicalRecoveryAvailable = true;
    request.alternateProviders = [{
      id: 'qwen',
      authorityIdentity: d('3'),
      mask: mask(true, true, true, true, true),
    }];

    expect(selectAuthorityRoute(request).route).toBe('hydrate');
  });

  it('skips an alternate provider without its own valid authority', () => {
    const request = base();
    request.pristineAvailable = false;
    request.alternateProviders = [{
      id: 'qwen-shadow',
      authorityIdentity: d('3'),
      mask: mask(true, true, false, false, true),
    }];

    expect(selectAuthorityRoute(request).route).toBe('unoptimized');
  });

  it('may select a validated alternate when conservative earlier routes are unavailable', () => {
    const request = base();
    request.pristineAvailable = false;
    request.alternateProviders = [{
      id: 'qwen-authoritative',
      authorityIdentity: d('3'),
      mask: mask(true, true, true, true, true),
    }];

    const decision = selectAuthorityRoute(request);
    expect(decision.route).toBe('alternate-provider');
    expect(decision.effectiveAuthorityIdentity).toBe(d('3'));
  });

  it('hands authority over without changing request/source lineage', () => {
    const first = selectAuthorityRoute(base());
    const request = base();
    request.pristineAvailable = false;
    request.routeGeneration = first.routeGeneration;
    request.alternateProviders = [{
      id: 'qwen-authoritative',
      authorityIdentity: d('3'),
      mask: mask(true, true, true, true, true),
    }];
    const next = selectAuthorityRoute(request);

    const handed = handoffAuthority(first, next, 'calibration-recovered');
    expect(handed.requestId).toBe(first.requestId);
    expect(handed.sourceLineageDigest).toBe(first.sourceLineageDigest);
    expect(handed.routeGeneration).toBe(first.routeGeneration + 1);
    expect(handed.previousAuthorityIdentity).toBe(first.effectiveAuthorityIdentity);
  });

  it('rejects a handoff across mismatched task/source lineage', () => {
    const first = selectAuthorityRoute(base());
    const next = { ...first, requestId: 'other' };

    expect(() => handoffAuthority(first, next, 'invalid')).toThrow(/lineage mismatch/i);
  });
});
