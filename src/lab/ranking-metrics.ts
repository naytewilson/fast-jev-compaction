import type { BinaryCalibrationSample } from './calibration-metrics.js';

export type RankingSample = Pick<BinaryCalibrationSample, 'probability' | 'outcome'>;

export function areaUnderRocCurve(
  _samples: readonly RankingSample[],
): number | null {
  throw new Error('RED: areaUnderRocCurve is not implemented');
}

export function averagePrecisionScore(
  _samples: readonly RankingSample[],
): number | null {
  throw new Error('RED: averagePrecisionScore is not implemented');
}
