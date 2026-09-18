import type { Digest256 } from './identity.js';
import { sha256Digest } from './recovery.js';

export interface CalibrationPromotionPolicy {
  minStrongHoldoutSamples: number;
  maxFalseAuthorityLeaks: number;
  maxECE: number;
  maxBrier: number;
  maxSelectiveRisk: number;
  minCoverage: number;
  maxRegressionTolerance?: number;
}

export interface CalibrationPromotionMetrics {
  ece: number;
  brier: number;
  selectiveRisk: number;
  coverage: number;
}

export interface CalibrationPromotionEvidence extends CalibrationPromotionMetrics {
  calibrationIdentity: Digest256;
  strongHoldoutSamples: number;
  falseAuthorityLeaks: number;
  champion?: CalibrationPromotionMetrics;
}

export interface CalibrationPromotionResult {
  status: 'CANARY_ELIGIBLE' | 'REMAIN_SHADOW';
  reasons: readonly string[];
  calibrationIdentity: Digest256;
  policyDigest: Digest256;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;

function unitInterval(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validMetrics(metrics: CalibrationPromotionMetrics): boolean {
  return (
    unitInterval(metrics.ece) &&
    unitInterval(metrics.brier) &&
    unitInterval(metrics.selectiveRisk) &&
    unitInterval(metrics.coverage)
  );
}

function validatePolicy(policy: CalibrationPromotionPolicy): Required<CalibrationPromotionPolicy> {
  if (
    !Number.isSafeInteger(policy.minStrongHoldoutSamples) ||
    policy.minStrongHoldoutSamples <= 0
  ) {
    throw new TypeError('minStrongHoldoutSamples must be a positive safe integer');
  }
  if (
    !Number.isSafeInteger(policy.maxFalseAuthorityLeaks) ||
    policy.maxFalseAuthorityLeaks < 0
  ) {
    throw new TypeError('maxFalseAuthorityLeaks must be a non-negative safe integer');
  }
  for (const [field, value] of [
    ['maxECE', policy.maxECE],
    ['maxBrier', policy.maxBrier],
    ['maxSelectiveRisk', policy.maxSelectiveRisk],
    ['minCoverage', policy.minCoverage],
  ] as const) {
    if (!unitInterval(value)) {
      throw new TypeError(`${field} must be finite in [0,1]`);
    }
  }
  const tolerance = policy.maxRegressionTolerance ?? 0;
  if (!unitInterval(tolerance)) {
    throw new TypeError('maxRegressionTolerance must be finite in [0,1]');
  }
  return Object.freeze({ ...policy, maxRegressionTolerance: tolerance });
}

export function evaluateCalibrationPromotion(
  evidence: CalibrationPromotionEvidence,
  policyInput: CalibrationPromotionPolicy,
): Readonly<CalibrationPromotionResult> {
  const policy = validatePolicy(policyInput);
  const policyDigest = sha256Digest(JSON.stringify({
    schema: 'anvil.calibration-promotion-policy.v1',
    ...policy,
  }));
  const reasons: string[] = [];

  if (!DIGEST.test(evidence.calibrationIdentity)) {
    reasons.push('INVALID_CALIBRATION_IDENTITY');
  }
  if (
    !Number.isSafeInteger(evidence.strongHoldoutSamples) ||
    evidence.strongHoldoutSamples < 0 ||
    !Number.isSafeInteger(evidence.falseAuthorityLeaks) ||
    evidence.falseAuthorityLeaks < 0 ||
    !validMetrics(evidence)
  ) {
    reasons.push('INVALID_METRIC');
  }

  if (reasons.length === 0) {
    if (evidence.strongHoldoutSamples < policy.minStrongHoldoutSamples) {
      reasons.push('INSUFFICIENT_STRONG_HOLDOUT');
    }
    if (evidence.falseAuthorityLeaks > policy.maxFalseAuthorityLeaks) {
      reasons.push('FALSE_AUTHORITY_BUDGET_EXCEEDED');
    }
    if (evidence.ece > policy.maxECE) reasons.push('ECE_BUDGET_EXCEEDED');
    if (evidence.brier > policy.maxBrier) reasons.push('BRIER_BUDGET_EXCEEDED');
    if (evidence.selectiveRisk > policy.maxSelectiveRisk) {
      reasons.push('SELECTIVE_RISK_BUDGET_EXCEEDED');
    }
    if (evidence.coverage < policy.minCoverage) {
      reasons.push('COVERAGE_BELOW_MINIMUM');
    }

    if (evidence.champion !== undefined) {
      if (!validMetrics(evidence.champion)) {
        reasons.push('INVALID_CHAMPION_METRIC');
      } else {
        const tolerance = policy.maxRegressionTolerance;
        const regressed =
          evidence.ece > evidence.champion.ece + tolerance ||
          evidence.brier > evidence.champion.brier + tolerance ||
          evidence.selectiveRisk > evidence.champion.selectiveRisk + tolerance ||
          evidence.coverage < evidence.champion.coverage - tolerance;
        if (regressed) reasons.push('CHAMPION_REGRESSION');
      }
    }
  }

  return Object.freeze({
    status: reasons.length === 0 ? 'CANARY_ELIGIBLE' : 'REMAIN_SHADOW',
    reasons: Object.freeze([...reasons]),
    calibrationIdentity: evidence.calibrationIdentity,
    policyDigest,
  });
}
