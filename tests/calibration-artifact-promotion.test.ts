import { describe, expect, it } from 'vitest';
import {
  CalibrationArtifactPromotionRegistry,
  verifyPromotedCalibrationArtifact,
} from '../src/lab/calibration-artifact-promotion.js';
import {
  makeCompiledPromotionEvidence,
} from './provider-authority-fixtures.js';

const policy = {
  minStrongHoldoutSamples: 5,
  maxFalseAuthorityLeaks: 0,
  maxECE: 0.1,
  maxBrier: 0.1,
  maxSelectiveRisk: 0.05,
  minCoverage: 0.8,
};

describe('CalibrationArtifactPromotionRegistry compiled evidence boundary', () => {
  it('promotes only with issued compiled evidence', () => {
    const { build, evidence } = makeCompiledPromotionEvidence();
    const promoted = new CalibrationArtifactPromotionRegistry().promote(
      build.calibrationArtifact,
      evidence,
      policy,
    );
    expect(promoted.calibrationIdentity).toBe(build.calibrationArtifact.calibrationIdentity);
    expect(verifyPromotedCalibrationArtifact(promoted)).toBe(true);
  });

  it('rejects plain metric vectors', () => {
    const { build } = makeCompiledPromotionEvidence();
    expect(() => new CalibrationArtifactPromotionRegistry().promote(
      build.calibrationArtifact,
      {
        strongHoldoutSamples: 10,
        falseAuthorityLeaks: 0,
        ece: 0,
        brier: 0,
        selectiveRisk: 0,
        coverage: 1,
      } as any,
      policy,
    )).toThrow(/compiled promotion evidence/i);
  });

  it('promotion remains blocked by one false-authority leak', () => {
    const chain = makeCompiledPromotionEvidence();
    const leaked = Object.create(Object.getPrototypeOf(chain.evidence));
    Object.assign(leaked, chain.evidence, { falseAuthorityLeaks: 1 });
    expect(() => new CalibrationArtifactPromotionRegistry().promote(
      chain.build.calibrationArtifact,
      leaked,
      policy,
    )).toThrow(/compiled promotion evidence|promotion/i);
  });
});
