import { describe, expect, it } from 'vitest';
import { AuthorityRegistry } from '../src/lab/authority-registry.js';
import {
  handoffAuthority,
  selectAuthorityRoute,
  type AuthorityRoutingRequest,
} from '../src/lab/authority-router.js';
import { makeCredential, d } from './provider-authority-fixtures.js';

function register(
  registry: AuthorityRegistry,
  providerId = 'typesafe-system-one/jev-1.13.0',
  generation = 7,
) {
  return registry.registerCredential(makeCredential(providerId, generation).credential);
}

function base(primaryRouteId: string): AuthorityRoutingRequest {
  return {
    requestId: 'req-1',
    sourceLineageDigest: d('7'),
    routeGeneration: 7,
    primaryRouteId,
    evidenceDeficit: false,
    mechanicalRecoveryAvailable: false,
    pristineAvailable: true,
    compatibleProfileRouteIds: [],
    alternateProviderRouteIds: [],
  };
}

describe('AuthorityRouter with artifact-descended routes', () => {
  it('uses a registered primary only when no evidence deficit is declared', () => {
    const registry = new AuthorityRegistry();
    const primary = register(registry);
    expect(selectAuthorityRoute(base(primary.routeId), registry).route).toBe('primary');
  });

  it('routes recoverable evidence deficit before semantic authority', () => {
    const registry = new AuthorityRegistry();
    const primary = register(registry);
    const request = base(primary.routeId);
    request.evidenceDeficit = true;
    request.mechanicalRecoveryAvailable = true;
    expect(selectAuthorityRoute(request, registry).route).toBe('hydrate');
  });

  it('uses pristine when evidence is deficient and cannot hydrate', () => {
    const registry = new AuthorityRegistry();
    const primary = register(registry);
    const request = base(primary.routeId);
    request.evidenceDeficit = true;
    expect(selectAuthorityRoute(request, registry).route).toBe('pristine');
  });

  it('unknown route ids cannot manufacture authority', () => {
    const request = base('authority:forged:99');
    request.pristineAvailable = false;
    expect(selectAuthorityRoute(request, new AuthorityRegistry()).route).toBe('unoptimized');
  });

  it('selects only an independently promoted alternate', () => {
    const registry = new AuthorityRegistry();
    const alternate = register(registry, 'neo/qwen-ane');
    const request = base('authority:missing:7');
    request.pristineAvailable = false;
    request.alternateProviderRouteIds = [alternate.routeId];
    const decision = selectAuthorityRoute(request, registry);
    expect(decision.route).toBe('alternate-provider');
    expect(decision.effectiveAuthorityIdentity).toBe(alternate.authorityIdentity);
  });

  it('hands authority over without changing task/source lineage', () => {
    const registry = new AuthorityRegistry();
    const primary = register(registry);
    const alternate = register(registry, 'neo/qwen-ane');
    const first = selectAuthorityRoute(base(primary.routeId), registry);

    const request = base('authority:missing:7');
    request.routeGeneration = first.routeGeneration;
    request.pristineAvailable = false;
    request.alternateProviderRouteIds = [alternate.routeId];
    const next = selectAuthorityRoute(request, registry);
    const handed = handoffAuthority(first, next, 'provider-handoff');

    expect(handed.requestId).toBe(first.requestId);
    expect(handed.sourceLineageDigest).toBe(first.sourceLineageDigest);
    expect(handed.routeGeneration).toBe(first.routeGeneration + 1);
    expect(handed.previousAuthorityIdentity).toBe(first.effectiveAuthorityIdentity);
    expect(handed.effectiveAuthorityIdentity).toBe(alternate.authorityIdentity);
  });
});
