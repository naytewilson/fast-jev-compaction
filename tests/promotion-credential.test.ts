import { describe, expect, it } from 'vitest';
import {
  PromotionAuthorityIssuer,
  verifyPromotedAuthorityCredential,
} from '../src/lab/promotion-credential.js';
import { evaluateCalibrationPromotion } from '../src/lab/calibration-promotion.js';
import { makeCredential, makePromotedArtifact, makeProviderProfile, d } from './provider-authority-fixtures.js';

describe('artifact-descended promotion credential', () => {
  it('mints from an issued promoted calibration artifact', () => {
    const { credential, promotedArtifact } = makeCredential();
    expect(credential.calibrationIdentity).toBe(promotedArtifact.calibrationIdentity);
    expect(credential.promotedArtifactDigest).toBe(promotedArtifact.promotedArtifactDigest);
    expect(verifyPromotedAuthorityCredential(credential)).toBe(true);
  });

  it('rejects a promoted artifact from another provider profile', () => {
    const qwen = makeProviderProfile('neo/qwen-ane');
    const { promotedArtifact } = makePromotedArtifact('typesafe-system-one/jev-1.13.0');

    expect(() => new PromotionAuthorityIssuer().issue({
      providerProfile: qwen,
      promotedArtifact,
      policyProfileDigest: d('6'),
      observationABIDigest: qwen.observationABIDigest,
      sourceLineageDigest: d('7'),
      authorityGeneration: 7,
    })).toThrow(/provider profile/i);
  });

  it('generic promotion results no longer satisfy the issuer', () => {
    const providerProfile = makeProviderProfile();
    const generic = evaluateCalibrationPromotion({
      calibrationIdentity: d('a'),
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

    expect(() => new PromotionAuthorityIssuer().issue({
      providerProfile,
      promotedArtifact: generic as any,
      policyProfileDigest: d('6'),
      observationABIDigest: providerProfile.observationABIDigest,
      sourceLineageDigest: d('7'),
      authorityGeneration: 7,
    })).toThrow(/promoted calibration artifact/i);
  });

  it('plain credential copies remain non-credentials', () => {
    const { credential } = makeCredential();
    expect(verifyPromotedAuthorityCredential({ ...credential })).toBe(false);
  });
});
