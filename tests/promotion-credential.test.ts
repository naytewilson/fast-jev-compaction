import { describe, expect, it } from 'vitest';
import { evaluateCalibrationPromotion } from '../src/lab/calibration-promotion.js';
import {
  PromotionAuthorityIssuer,
  verifyPromotedAuthorityCredential,
} from '../src/lab/promotion-credential.js';
import { deriveProviderExecutionProfile } from '../src/lab/provider-profile.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

const promotionPolicy = {
  minStrongHoldoutSamples: 100,
  maxFalseAuthorityLeaks: 0,
  maxECE: 0.05,
  maxBrier: 0.1,
  maxSelectiveRisk: 0.02,
  minCoverage: 0.8,
};

function promotion(calibrationIdentity = d('a')) {
  return evaluateCalibrationPromotion({
    calibrationIdentity,
    strongHoldoutSamples: 500,
    falseAuthorityLeaks: 0,
    ece: 0.02,
    brier: 0.04,
    selectiveRisk: 0.01,
    coverage: 0.9,
  }, promotionPolicy);
}

function profile(providerId = 'typesafe-system-one/jev-1.13.0', kind: any = 'jev-system-one') {
  return deriveProviderExecutionProfile({
    providerId,
    providerKind: kind,
    modelIdentityDigest: providerId.includes('qwen') ? d('2') : d('1'),
    modelAssurance: providerId.includes('qwen') ? 'contentVerified' : 'opaqueVersioned',
    executionSemanticsDigest: providerId.includes('qwen') ? d('4') : d('3'),
    normalizerDigest: d('5'),
    observationABIDigest: d('6'),
  });
}

function issue(provider = profile(), p = promotion()) {
  return new PromotionAuthorityIssuer().issue({
    providerProfile: provider,
    promotion: p,
    policyProfileDigest: d('7'),
    observationABIDigest: d('6'),
    sourceLineageDigest: d('8'),
    authorityGeneration: 3,
  });
}

describe('promotion-issued authority credential', () => {
  it('mints only from an eligible promotion decision', () => {
    const credential = issue();
    expect(credential.schema).toBe('anvil.promoted-authority-credential.v1');
    expect(Object.isFrozen(credential)).toBe(true);
    expect(verifyPromotedAuthorityCredential(credential)).toBe(true);

    const shadow = evaluateCalibrationPromotion({
      calibrationIdentity: d('a'),
      strongHoldoutSamples: 500,
      falseAuthorityLeaks: 1,
      ece: 0.02,
      brier: 0.04,
      selectiveRisk: 0.01,
      coverage: 0.9,
    }, promotionPolicy);

    expect(() => issue(profile(), shadow)).toThrow(/CANARY_ELIGIBLE/i);
  });

  it('binds credential identity to the provider profile', () => {
    const jevCredential = issue(profile());
    const qwenCredential = issue(profile('neo/qwen-ane', 'qwen-ane'));
    expect(qwenCredential.credentialDigest).not.toBe(jevCredential.credentialDigest);
    expect(qwenCredential.providerProfileDigest).not.toBe(jevCredential.providerProfileDigest);
  });

  it('rejects ABI mismatch during issuance', () => {
    expect(() => new PromotionAuthorityIssuer().issue({
      providerProfile: profile(),
      promotion: promotion(),
      policyProfileDigest: d('7'),
      observationABIDigest: d('9'),
      sourceLineageDigest: d('8'),
      authorityGeneration: 3,
    })).toThrow(/observation ABI/i);
  });

  it('plain structural copies do not become valid credentials', () => {
    const credential = issue();
    expect(verifyPromotedAuthorityCredential({ ...credential })).toBe(false);
  });

  it('measurement evidence cannot be substituted for a promotion decision', () => {
    expect(() => new PromotionAuthorityIssuer().issue({
      providerProfile: profile('neo/qwen-ane', 'qwen-ane'),
      promotion: { status: 'MEASUREMENT_ACCEPTED_NO_AUTHORITY' } as any,
      policyProfileDigest: d('7'),
      observationABIDigest: d('6'),
      sourceLineageDigest: d('8'),
      authorityGeneration: 3,
    })).toThrow(/CANARY_ELIGIBLE/i);
  });
});
