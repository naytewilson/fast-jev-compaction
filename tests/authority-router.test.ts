import { describe, expect, it } from 'vitest';
import { AuthorityRegistry } from '../src/lab/authority-registry.js';
import {
  handoffAuthority,
  selectAuthorityRoute,
  type AuthorityRoutingRequest,
} from '../src/lab/authority-router.js';

const d = (c: string) => 'sha256:' + c.repeat(64);
const authoritativeMask = {
  source: true,
  evidence: true,
  calibration: true,
  authority: true,
  recovery: true,
};

function registry(): AuthorityRegistry {
  const registry = new AuthorityRegistry();
  registry.register({
    routeId: 'qwen-authoritative',
    calibrationIdentity: d('3'),
    authorityIdentity: d('4'),
    sourceLineageDigest: d('1'),
    authorityGeneration: 7,
    mask: authoritativeMask,
  });
  return registry;
}

function base(): AuthorityRoutingRequest {
  return {
    requestId: 'req-1',
    sourceLineageDigest: d('1'),
    routeGeneration: 7,
    primaryRouteId: 'jev-primary-unregistered',
    evidenceDeficit: false,
    mechanicalRecoveryAvailable: false,
    pristineAvailable: true,
    compatibleProfileRouteIds: [],
    alternateProviderRouteIds: [],
  };
}

describe('AuthorityRouter', () => {
  it('falls back to pristine when no registered primary authority exists', () => {
    const decision = selectAuthorityRoute(base(), registry());
    expect(decision.route).toBe('pristine');
    expect(decision.taskContinues).toBe(true);
    expect(decision.effectiveAuthorityIdentity).toBeNull();
  });

  it('hydrates a recoverable evidence deficit before considering alternate providers', () => {
    const request = base();
    request.evidenceDeficit = true;
    request.mechanicalRecoveryAvailable = true;
    request.alternateProviderRouteIds = ['qwen-authoritative'];

    expect(selectAuthorityRoute(request, registry()).route).toBe('hydrate');
  });

  it('unknown caller-supplied route ids cannot mint authority', () => {
    const request = base();
    request.pristineAvailable = false;
    request.primaryRouteId = 'forged';
    request.compatibleProfileRouteIds = ['also-forged'];
    request.alternateProviderRouteIds = ['still-forged'];

    expect(selectAuthorityRoute(request, registry()).route).toBe('unoptimized');
  });

  it('may select a registered alternate with its own valid authority', () => {
    const request = base();
    request.pristineAvailable = false;
    request.alternateProviderRouteIds = ['qwen-authoritative'];

    const decision = selectAuthorityRoute(request, registry());
    expect(decision.route).toBe('alternate-provider');
    expect(decision.effectiveAuthorityIdentity).toBe(d('4'));
  });

  it('hands authority over without changing request/source lineage', () => {
    const reg = registry();
    const first = selectAuthorityRoute(base(), reg);
    const request = base();
    request.pristineAvailable = false;
    request.routeGeneration = first.routeGeneration;
    request.alternateProviderRouteIds = ['qwen-authoritative'];
    const next = selectAuthorityRoute(request, reg);

    const handed = handoffAuthority(first, next, 'calibration-recovered');
    expect(handed.requestId).toBe(first.requestId);
    expect(handed.sourceLineageDigest).toBe(first.sourceLineageDigest);
    expect(handed.routeGeneration).toBe(first.routeGeneration + 1);
    expect(handed.previousAuthorityIdentity).toBe(first.effectiveAuthorityIdentity);
  });

  it('rejects a handoff across mismatched task/source lineage', () => {
    const first = selectAuthorityRoute(base(), registry());
    const next = { ...first, requestId: 'other' };

    expect(() => handoffAuthority(first, next, 'invalid')).toThrow(/lineage mismatch/i);
  });
});
