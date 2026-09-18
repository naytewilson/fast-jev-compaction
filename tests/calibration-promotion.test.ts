import { describe, expect, it } from 'vitest';
import { evaluateCalibrationPromotion } from '../src/lab/calibration-promotion.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

const policy = {
  minStrongHoldoutSamples: 100,
  maxFalseAuthorityLeaks: 0,
  maxECE: 0.05,
  maxBrier: 0.1,
  maxSelectiveRisk: 0.02,
  minCoverage: 0.8,
  maxRegressionTolerance: 0.01,
};

const evidence = {
  calibrationIdentity: d('1'),
  strongHoldoutSamples: 500,
  falseAuthorityLeaks: 0,
  ece: 0.02,
  brier: 0.04,
  selectiveRisk: 0.01,
  coverage: 0.9,
  champion: {
    ece: 0.02,
    brier: 0.04,
    selectiveRisk: 0.01,
    coverage: 0.9,
  },
};

describe('deterministic calibration promotion gate', () => {
  it('returns canary eligibility without granting authority', () => {
    const result = evaluateCalibrationPromotion(evidence, policy);
    expect(result.status).toBe('CANARY_ELIGIBLE');
    expect(result.reasons).toEqual([]);
    expect(result.calibrationIdentity).toBe(d('1'));
    expect(result.policyDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect('authorityGranted' in result).toBe(false);
  });

  it('keeps insufficient or false-authority-leaking candidates in shadow', () => {
    expect(evaluateCalibrationPromotion({
      ...evidence,
      strongHoldoutSamples: 99,
    }, policy).status).toBe('REMAIN_SHADOW');

    const leak = evaluateCalibrationPromotion({
      ...evidence,
      falseAuthorityLeaks: 1,
    }, policy);
    expect(leak.status).toBe('REMAIN_SHADOW');
    expect(leak.reasons).toContain('FALSE_AUTHORITY_BUDGET_EXCEEDED');
  });

  it('rejects champion regression beyond configured tolerance', () => {
    const result = evaluateCalibrationPromotion({
      ...evidence,
      ece: 0.04,
    }, policy);
    expect(result.status).toBe('REMAIN_SHADOW');
    expect(result.reasons).toContain('CHAMPION_REGRESSION');
  });

  it('rejects invalid metrics instead of normalizing them', () => {
    const result = evaluateCalibrationPromotion({
      ...evidence,
      ece: Number.NaN,
    }, policy);
    expect(result.status).toBe('REMAIN_SHADOW');
    expect(result.reasons).toContain('INVALID_METRIC');
  });
});
