import { describe, expect, it } from 'vitest';
import {
  CalibrationArtifactPromotionRegistry,
  verifyPromotedCalibrationArtifact,
} from '../src/lab/calibration-artifact-promotion.js';
import { makeArtifact } from './provider-authority-fixtures.js';

const policy = {
  minStrongHoldoutSamples: 100,
  maxFalseAuthorityLeaks: 0,
  maxECE: 0.05,
  maxBrier: 0.1,
  maxSelectiveRisk: 0.02,
  minCoverage: 0.8,
};

const goodEvidence = {
  strongHoldoutSamples: 500,
  falseAuthorityLeaks: 0,
  ece: 0.02,
  brier: 0.04,
  selectiveRisk: 0.01,
  coverage: 0.9,
};

describe('CalibrationArtifactPromotionRegistry', () => {
  it('promotes an eligible registered calibration artifact', () => {
    const { artifact } = makeArtifact();
    const promoted = new CalibrationArtifactPromotionRegistry()
      .promote(artifact, goodEvidence, policy);

    expect(promoted.schema).toBe('anvil.promoted-calibration-artifact.v1');
    expect(promoted.artifactDigest).toBe(artifact.artifactDigest);
    expect(promoted.calibrationIdentity).toBe(artifact.calibrationIdentity);
    expect(verifyPromotedCalibrationArtifact(promoted)).toBe(true);
  });

  it('does not mint a promoted artifact from ineligible evidence', () => {
    const { artifact } = makeArtifact();
    expect(() => new CalibrationArtifactPromotionRegistry().promote(
      artifact,
      { ...goodEvidence, falseAuthorityLeaks: 1 },
      policy,
    )).toThrow(/CANARY_ELIGIBLE|promotion/i);
  });

  it('rejects structural promoted-artifact copies', () => {
    const { artifact } = makeArtifact();
    const promoted = new CalibrationArtifactPromotionRegistry()
      .promote(artifact, goodEvidence, policy);
    expect(verifyPromotedCalibrationArtifact({ ...promoted })).toBe(false);
  });

  it('rejects measurement-like objects as promoted calibration artifacts', () => {
    expect(verifyPromotedCalibrationArtifact({
      schema: 'anvil.local-hardware-receipt.v2',
      productionAuthorityGranted: false,
    })).toBe(false);
  });
});
