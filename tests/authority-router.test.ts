import { describe, expect, it } from 'vitest';
import { AuthorityRegistry } from '../src/lab/authority-registry.js';
import { evaluateCalibrationPromotion } from '../src/lab/calibration-promotion.js';
import {
  handoffAuthority,
  selectAuthorityRoute,
  type AuthorityRoutingRequest,
} from '../src/lab/authority-router.js';
import { PromotionAuthorityIssuer } from '../src/lab/promotion-credential.js';
import { deriveProviderExecutionProfile } from '../src/lab/provider-profile.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

function register(
  registry: AuthorityRegistry,
  providerId: string,
  generation = 7,
) {
  const profile = deriveProviderExecutionProfile({
    providerId,
    providerKind: providerId.includes('qwen') ? 'qwen-ane' : 'jev-system-one',
    modelIdentityDigest: providerId.includes('qwen') ? d('2') : d('1'),
    modelAssurance: providerId.includes('qwen') ? 'contentVerified' : 'opaqueVersioned',
    executionSemanticsDigest: providerId.includes('qwen') ? d('4') : d('3'),
    normalizerDigest: d('5'),
    observationABIDigest: d('6'),
  });
  const promotion = evaluateCalibrationPromotion({
    calibrationIdentity: providerId.includes('qwen') ? d('b') : d('a'),
    strongHoldoutSamples: 500,
    falseAuthorityLeaks: 0,
    ece: 0.02,
    brier: 0.04,
    selectiveRisk: 0.01,
    coverage: 0.9,
  }, {
    minStrongHoldoutSamples: 100,
    maxFalseAuthorityLeaks: 0,
    maxECE: 0.05,
    maxBrier: 0.1,
    maxSelectiveRisk: 0.02,
    minCoverage: 0.8,
  });
  const credential = new PromotionAuthorityIssuer().issue({
    providerProfile: profile,
    promotion,
    policyProfileDigest: d('7'),
    observationABIDigest: d('6'),
    sourceLineageDigest: d('8'),
    authorityGeneration: generation,
  });
  return registry.registerCredential(credential);
}

function base(primaryRouteId: string): AuthorityRoutingRequest {
  return {
    requestId: 'req-1',
    sourceLineageDigest: d('8'),
    routeGeneration: 7,
    primaryRouteId,
    evidenceDeficit: false,
    mechanicalRecoveryAvailable: false,
    pristineAvailable: true,
    compatibleProfileRouteIds: [],
    alternateProviderRouteIds: [],
  };
}

describe('AuthorityRouter with promotion-issued routes', () => {
  it('uses a registered primary only when no evidence deficit is declared', () => {
    const registry = new AuthorityRegistry();
    const primary = register(registry, 'typesafe-system-one/jev-1.13.0');
    expect(selectAuthorityRoute(base(primary.routeId), registry).route).toBe('primary');
  });

  it('routes a recoverable evidence deficit to hydration before semantic authority', () => {
    const registry = new AuthorityRegistry();
    const primary = register(registry, 'typesafe-system-one/jev-1.13.0');
    const request = base(primary.routeId);
    request.evidenceDeficit = true;
    request.mechanicalRecoveryAvailable = true;

    expect(selectAuthorityRoute(request, registry).route).toBe('hydrate');
  });

  it('uses pristine rather than primary when evidence is deficient and cannot hydrate', () => {
    const registry = new AuthorityRegistry();
    const primary = register(registry, 'typesafe-system-one/jev-1.13.0');
    const request = base(primary.routeId);
    request.evidenceDeficit = true;

    expect(selectAuthorityRoute(request, registry).route).toBe('pristine');
  });

  it('unknown route ids cannot manufacture authority', () => {
    const request = base('authority:forged:99');
    request.pristineAvailable = false;
    expect(selectAuthorityRoute(request, new AuthorityRegistry()).route).toBe('unoptimized');
  });

  it('selects only a registered alternate when conservative earlier routes are unavailable', () => {
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
    const primary = register(registry, 'typesafe-system-one/jev-1.13.0');
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
