import { describe, expect, it } from 'vitest';
import { AuthorityRegistry } from '../src/lab/authority-registry.js';
import { evaluateCalibrationPromotion } from '../src/lab/calibration-promotion.js';
import { PromotionAuthorityIssuer } from '../src/lab/promotion-credential.js';
import { deriveProviderExecutionProfile } from '../src/lab/provider-profile.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

function credential(providerId = 'typesafe-system-one/jev-1.13.0', generation = 7) {
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

  return new PromotionAuthorityIssuer().issue({
    providerProfile: profile,
    promotion,
    policyProfileDigest: d('7'),
    observationABIDigest: d('6'),
    sourceLineageDigest: d('8'),
    authorityGeneration: generation,
  });
}

describe('AuthorityRegistry promotion credential boundary', () => {
  it('registers only issued credentials and derives a stable route id', () => {
    const registry = new AuthorityRegistry();
    const c = credential();
    const grant = registry.registerCredential(c);

    expect(grant.routeId).toBe('authority:typesafe-system-one/jev-1.13.0:7');
    expect(grant.providerProfileDigest).toBe(c.providerProfileDigest);
    expect(grant.calibrationIdentity).toBe(c.calibrationIdentity);
    expect(grant.calibrationAuthorized).toBe(true);
    expect(grant.policyProfileAuthorized).toBe(true);
    expect('mask' in grant).toBe(false);
    expect(registry.resolve(grant.routeId, d('8'))).toBe(grant);
  });

  it('rejects structural credential copies', () => {
    const registry = new AuthorityRegistry();
    expect(() => registry.registerCredential({ ...credential() } as any))
      .toThrow(/issued promotion credential/i);
  });

  it('fails resolution across source lineage', () => {
    const registry = new AuthorityRegistry();
    const grant = registry.registerCredential(credential());
    expect(registry.resolve(grant.routeId, d('9'))).toBeNull();
  });

  it('rejects duplicate provider generation routes', () => {
    const registry = new AuthorityRegistry();
    registry.registerCredential(credential());
    expect(() => registry.registerCredential(credential()))
      .toThrow(/duplicate route/i);
  });

  it('keeps providers in separate route namespaces', () => {
    const registry = new AuthorityRegistry();
    const jev = registry.registerCredential(credential());
    const qwen = registry.registerCredential(credential('neo/qwen-ane'));
    expect(jev.routeId).not.toBe(qwen.routeId);
    expect(jev.providerProfileDigest).not.toBe(qwen.providerProfileDigest);
  });
});
