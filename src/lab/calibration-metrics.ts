export interface BinaryCalibrationSample {
  probability: number;
  outcome: 0 | 1;
  selected?: boolean;
}

export interface SelectiveRiskCoverage {
  total: number;
  selected: number;
  coverage: number;
  errors: number;
  risk: number | null;
}

export interface AuthorityTrialRecord {
  shouldHavePolicyAuthority: boolean;
  policyTriggered: boolean;
}

export interface FalseAuthorityMetrics {
  opportunities: number;
  leaks: number;
  fasr: number | null;
  observedFar: number | null;
  approximateFarUpper95: number | null;
}

function validateSample(sample: BinaryCalibrationSample): void {
  if (
    typeof sample.probability !== 'number' ||
    !Number.isFinite(sample.probability) ||
    sample.probability < 0 ||
    sample.probability > 1
  ) {
    throw new TypeError('probability must be finite in [0,1]');
  }
  if (sample.outcome !== 0 && sample.outcome !== 1) {
    throw new TypeError('outcome must be 0 or 1');
  }
}

function requireSamples(samples: readonly BinaryCalibrationSample[]): void {
  if (samples.length === 0) throw new TypeError('calibration samples must not be empty');
  samples.forEach(validateSample);
}

export function expectedCalibrationError(
  samples: readonly BinaryCalibrationSample[],
  bins: number,
): number {
  requireSamples(samples);
  if (!Number.isSafeInteger(bins) || bins <= 0) {
    throw new TypeError('bins must be a positive safe integer');
  }

  let weighted = 0;
  for (let bin = 0; bin < bins; bin += 1) {
    const lower = bin / bins;
    const upper = (bin + 1) / bins;
    const members = samples.filter((sample) =>
      bin === bins - 1
        ? sample.probability >= lower && sample.probability <= upper
        : sample.probability >= lower && sample.probability < upper,
    );
    if (members.length === 0) continue;

    const meanProbability =
      members.reduce((sum, sample) => sum + sample.probability, 0) / members.length;
    const meanOutcome =
      members.reduce((sum, sample) => sum + sample.outcome, 0) / members.length;
    weighted +=
      (members.length / samples.length) * Math.abs(meanProbability - meanOutcome);
  }
  return weighted;
}

export function brierScore(samples: readonly BinaryCalibrationSample[]): number {
  requireSamples(samples);
  return (
    samples.reduce(
      (sum, sample) => sum + (sample.probability - sample.outcome) ** 2,
      0,
    ) / samples.length
  );
}

export function negativeLogLikelihood(
  samples: readonly BinaryCalibrationSample[],
): number {
  requireSamples(samples);
  const epsilon = 1e-15;
  return (
    samples.reduce((sum, sample) => {
      const p = Math.min(1 - epsilon, Math.max(epsilon, sample.probability));
      return sum - (
        sample.outcome === 1 ? Math.log(p) : Math.log(1 - p)
      );
    }, 0) / samples.length
  );
}

export function thresholdLocalCalibrationError(
  samples: readonly BinaryCalibrationSample[],
  threshold: number,
  radius: number,
): number | null {
  requireSamples(samples);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new TypeError('threshold must be finite in [0,1]');
  }
  if (!Number.isFinite(radius) || radius < 0 || radius > 1) {
    throw new TypeError('radius must be finite in [0,1]');
  }

  const local = samples.filter(
    (sample) => Math.abs(sample.probability - threshold) <= radius,
  );
  if (local.length === 0) return null;
  return (
    local.reduce(
      (sum, sample) => sum + Math.abs(sample.probability - sample.outcome),
      0,
    ) / local.length
  );
}

export function selectiveRiskCoverage(
  samples: readonly BinaryCalibrationSample[],
): SelectiveRiskCoverage {
  requireSamples(samples);
  const selected = samples.filter((sample) => sample.selected === true);
  const errors = selected.filter((sample) => {
    const prediction: 0 | 1 = sample.probability >= 0.5 ? 1 : 0;
    return prediction !== sample.outcome;
  }).length;

  return {
    total: samples.length,
    selected: selected.length,
    coverage: selected.length / samples.length,
    errors,
    risk: selected.length === 0 ? null : errors / selected.length,
  };
}

export function falseAuthorityMetrics(
  records: readonly AuthorityTrialRecord[],
): FalseAuthorityMetrics {
  const invalid = records.filter((record) => !record.shouldHavePolicyAuthority);
  if (invalid.length === 0) {
    return {
      opportunities: 0,
      leaks: 0,
      fasr: null,
      observedFar: null,
      approximateFarUpper95: null,
    };
  }

  const leaks = invalid.filter((record) => record.policyTriggered).length;
  return {
    opportunities: invalid.length,
    leaks,
    fasr: 1 - leaks / invalid.length,
    observedFar: leaks / invalid.length,
    approximateFarUpper95:
      leaks === 0 ? Math.min(1, 3 / invalid.length) : null,
  };
}
