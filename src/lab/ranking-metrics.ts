import type { BinaryCalibrationSample } from './calibration-metrics.js';

export type RankingSample = Pick<BinaryCalibrationSample, 'probability' | 'outcome'>;

function validateSamples(samples: readonly RankingSample[]): void {
  if (samples.length === 0) {
    throw new TypeError('ranking samples must not be empty');
  }
  for (const sample of samples) {
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
}

export function areaUnderRocCurve(
  samples: readonly RankingSample[],
): number | null {
  validateSamples(samples);
  const positives = samples.filter((sample) => sample.outcome === 1).length;
  const negatives = samples.length - positives;
  if (positives === 0 || negatives === 0) return null;

  const sorted = [...samples].sort((a, b) => a.probability - b.probability);
  let positiveRankSum = 0;
  let index = 0;

  while (index < sorted.length) {
    let end = index + 1;
    while (
      end < sorted.length &&
      sorted[end].probability === sorted[index].probability
    ) {
      end += 1;
    }

    const firstRank = index + 1;
    const lastRank = end;
    const averageRank = (firstRank + lastRank) / 2;
    for (let cursor = index; cursor < end; cursor += 1) {
      if (sorted[cursor].outcome === 1) {
        positiveRankSum += averageRank;
      }
    }
    index = end;
  }

  const mannWhitney =
    positiveRankSum - (positives * (positives + 1)) / 2;
  return mannWhitney / (positives * negatives);
}

export function averagePrecisionScore(
  samples: readonly RankingSample[],
): number | null {
  validateSamples(samples);
  const positives = samples.filter((sample) => sample.outcome === 1).length;
  if (positives === 0) return null;

  const sorted = [...samples].sort((a, b) => b.probability - a.probability);
  let truePositives = 0;
  let falsePositives = 0;
  let averagePrecision = 0;
  let index = 0;

  while (index < sorted.length) {
    let end = index + 1;
    while (
      end < sorted.length &&
      sorted[end].probability === sorted[index].probability
    ) {
      end += 1;
    }

    let groupPositives = 0;
    let groupNegatives = 0;
    for (let cursor = index; cursor < end; cursor += 1) {
      if (sorted[cursor].outcome === 1) groupPositives += 1;
      else groupNegatives += 1;
    }

    truePositives += groupPositives;
    falsePositives += groupNegatives;
    if (groupPositives > 0) {
      const recallIncrement = groupPositives / positives;
      const precision =
        truePositives / (truePositives + falsePositives);
      averagePrecision += recallIncrement * precision;
    }
    index = end;
  }

  return averagePrecision;
}
