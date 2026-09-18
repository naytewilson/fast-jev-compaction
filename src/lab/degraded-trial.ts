import {
  brierScore,
  expectedCalibrationError,
  falseAuthorityMetrics,
  negativeLogLikelihood,
  type BinaryCalibrationSample,
  type FalseAuthorityMetrics,
} from './calibration-metrics.js';

export type DegradedScenario =
  | 'FULL'
  | 'PARTIAL'
  | 'HEAD_TAIL'
  | 'CONTRADICTORY'
  | 'IRRELEVANT'
  | 'ABSENT'
  | 'MODEL_BUMP'
  | 'QUANTIZATION_SHIFT'
  | 'NORMALIZER_SHIFT'
  | 'CALIBRATION_POISON_ATTEMPT'
  | 'DUPLICATE_RECALIBRATION_STORM'
  | 'CANARY_REGRESSION'
  | 'ROLLBACK'
  | 'STALE_EVIDENCE_VIEW'
  | 'RECEIPT_ENRICHMENT_PRESSURE'
  | 'PROVIDER_IDENTITY_DOWNGRADE';

export interface DegradedTrialCycle {
  scenario: DegradedScenario;
  shouldHavePolicyAuthority: boolean;
  policyTriggered: boolean;
  taskCompleted: boolean;
  fallbackActivated: boolean;
  detectMs: number;
  routeMs: number;
  firstUsefulResultMs: number | null;
  fallbackCompleteMs: number | null;
  calibrationProbability?: number;
  calibrationOutcome?: 0 | 1;
  syntheticTiming: boolean;
}

export interface PercentileSummary {
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

export interface DegradedTrialCalibrationSummary {
  count: number;
  ece: number;
  brier: number;
  nll: number;
}

export type DegradedTrialVerdict =
  | 'ARCHITECTURAL_FAILURE'
  | 'PASS_SYNTHETIC'
  | 'PASS_MEASURED'
  | 'PASS_MIXED'
  | 'UNSCORED';

export interface DegradedTrialResult {
  cycleCount: number;
  scenarioCounts: Record<DegradedScenario, number>;
  falseAuthority: FalseAuthorityMetrics;
  fallbackCoverageRetention: number | null;
  fallbackActivationRate: number | null;
  routeLatencyMs: PercentileSummary;
  firstUsefulResultMs: PercentileSummary;
  calibration: DegradedTrialCalibrationSummary | null;
  timingEvidence: 'synthetic' | 'measured' | 'mixed';
  verdict: DegradedTrialVerdict;
}

const SCENARIOS: readonly DegradedScenario[] = [
  'FULL',
  'PARTIAL',
  'HEAD_TAIL',
  'CONTRADICTORY',
  'IRRELEVANT',
  'ABSENT',
  'MODEL_BUMP',
  'QUANTIZATION_SHIFT',
  'NORMALIZER_SHIFT',
  'CALIBRATION_POISON_ATTEMPT',
  'DUPLICATE_RECALIBRATION_STORM',
  'CANARY_REGRESSION',
  'ROLLBACK',
  'STALE_EVIDENCE_VIEW',
  'RECEIPT_ENRICHMENT_PRESSURE',
  'PROVIDER_IDENTITY_DOWNGRADE',
];

function finiteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be finite and non-negative`);
  }
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[index];
}

function summarize(values: readonly number[]): PercentileSummary {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
  };
}

function validateCycle(cycle: DegradedTrialCycle): void {
  finiteNonNegative(cycle.detectMs, 'detectMs');
  finiteNonNegative(cycle.routeMs, 'routeMs');
  if (cycle.firstUsefulResultMs !== null) {
    finiteNonNegative(cycle.firstUsefulResultMs, 'firstUsefulResultMs');
  }
  if (cycle.fallbackCompleteMs !== null) {
    finiteNonNegative(cycle.fallbackCompleteMs, 'fallbackCompleteMs');
  }
  const hasProbability = cycle.calibrationProbability !== undefined;
  const hasOutcome = cycle.calibrationOutcome !== undefined;
  if (hasProbability !== hasOutcome) {
    throw new TypeError('calibration probability/outcome must be supplied together');
  }
}

export function evaluateDegradedTrial(
  cycles: readonly DegradedTrialCycle[],
): DegradedTrialResult {
  if (cycles.length === 0) throw new TypeError('degraded trial must contain at least one cycle');
  cycles.forEach(validateCycle);

  const scenarioCounts = Object.fromEntries(
    SCENARIOS.map((scenario) => [scenario, 0]),
  ) as Record<DegradedScenario, number>;
  for (const cycle of cycles) scenarioCounts[cycle.scenario] += 1;

  const falseAuthority = falseAuthorityMetrics(
    cycles.map((cycle) => ({
      shouldHavePolicyAuthority: cycle.shouldHavePolicyAuthority,
      policyTriggered: cycle.policyTriggered,
    })),
  );

  const fallbackRequired = cycles.filter(
    (cycle) => !cycle.shouldHavePolicyAuthority,
  );
  const fallbackCoverageRetention =
    fallbackRequired.length === 0
      ? null
      : fallbackRequired.filter((cycle) => cycle.taskCompleted).length /
        fallbackRequired.length;
  const fallbackActivationRate =
    fallbackRequired.length === 0
      ? null
      : fallbackRequired.filter((cycle) => cycle.fallbackActivated).length /
        fallbackRequired.length;

  const routeLatencyMs = summarize(
    cycles.map((cycle) => cycle.detectMs + cycle.routeMs),
  );
  const firstUsefulResultMs = summarize(
    cycles.flatMap((cycle) =>
      cycle.firstUsefulResultMs === null ? [] : [cycle.firstUsefulResultMs],
    ),
  );

  const calibrationSamples: BinaryCalibrationSample[] = cycles.flatMap((cycle) =>
    cycle.calibrationProbability === undefined || cycle.calibrationOutcome === undefined
      ? []
      : [{
          probability: cycle.calibrationProbability,
          outcome: cycle.calibrationOutcome,
        }],
  );

  const calibration =
    calibrationSamples.length === 0
      ? null
      : {
          count: calibrationSamples.length,
          ece: expectedCalibrationError(calibrationSamples, Math.min(10, calibrationSamples.length)),
          brier: brierScore(calibrationSamples),
          nll: negativeLogLikelihood(calibrationSamples),
        };

  const syntheticCount = cycles.filter((cycle) => cycle.syntheticTiming).length;
  const timingEvidence =
    syntheticCount === cycles.length
      ? 'synthetic'
      : syntheticCount === 0
        ? 'measured'
        : 'mixed';

  let verdict: DegradedTrialVerdict;
  if (falseAuthority.opportunities === 0) {
    verdict = 'UNSCORED';
  } else if (falseAuthority.leaks > 0) {
    verdict = 'ARCHITECTURAL_FAILURE';
  } else if (timingEvidence === 'synthetic') {
    verdict = 'PASS_SYNTHETIC';
  } else if (timingEvidence === 'measured') {
    verdict = 'PASS_MEASURED';
  } else {
    verdict = 'PASS_MIXED';
  }

  return {
    cycleCount: cycles.length,
    scenarioCounts,
    falseAuthority,
    fallbackCoverageRetention,
    fallbackActivationRate,
    routeLatencyMs,
    firstUsefulResultMs,
    calibration,
    timingEvidence,
    verdict,
  };
}
