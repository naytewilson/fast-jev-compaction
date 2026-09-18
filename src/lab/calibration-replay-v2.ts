import type { Digest256 } from './identity.js';
import {
  MODELED_SEMANTIC_AXES_V2,
  type ModeledSemanticAxisV2,
} from './semantic-contract-v2.js';
import {
  selectAuthoritativeSemanticLabelsV2,
  type SemanticCalibrationLabelV2,
} from './semantic-label-v2.js';

export interface SemanticReplayPredictionV2 {
  labelId: string;
  predicateId: ModeledSemanticAxisV2;
  sourceDigest: Digest256;
  executionProfileDigest: Digest256;
  observationDigest: Digest256;
  probability: number;
}

export interface CalibrationReplaySampleV2 {
  labelId: string;
  sourceDigest: Digest256;
  predicateId: ModeledSemanticAxisV2;
  executionProfileDigest: Digest256;
  observationDigest: Digest256;
  probability: number;
  target: 0 | 1;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;

function validatePrediction(
  prediction: SemanticReplayPredictionV2,
): void {
  if (prediction.labelId.length === 0) {
    throw new TypeError('semantic v2 prediction labelId must be non-empty');
  }
  if (!MODELED_SEMANTIC_AXES_V2.includes(prediction.predicateId)) {
    throw new TypeError(
      'semantic v2 prediction predicate must be one of the four modeled predicates',
    );
  }
  for (const [field, value] of [
    ['sourceDigest', prediction.sourceDigest],
    ['executionProfileDigest', prediction.executionProfileDigest],
    ['observationDigest', prediction.observationDigest],
  ] as const) {
    if (!DIGEST.test(value)) {
      throw new TypeError(`${field} must be canonical sha256`);
    }
  }
  if (
    !Number.isFinite(prediction.probability) ||
    prediction.probability < 0 ||
    prediction.probability > 1
  ) {
    throw new TypeError('semantic v2 prediction probability must be finite in [0,1]');
  }
}

export function joinCalibrationReplayV2(
  labels: readonly SemanticCalibrationLabelV2[],
  predictions: readonly SemanticReplayPredictionV2[],
): readonly Readonly<CalibrationReplaySampleV2>[] {
  if (labels.some((label) => label.authority !== 'STRONG')) {
    throw new Error('authoritative semantic v2 calibration accepts STRONG labels only');
  }
  const authoritative = selectAuthoritativeSemanticLabelsV2(labels);
  if (authoritative.length !== predictions.length) {
    throw new Error('semantic v2 calibration replay cardinality mismatch');
  }

  const byID = new Map<string, SemanticReplayPredictionV2>();
  for (const prediction of predictions) {
    validatePrediction(prediction);
    if (byID.has(prediction.labelId)) {
      throw new Error(`duplicate semantic v2 prediction label id ${prediction.labelId}`);
    }
    byID.set(prediction.labelId, prediction);
  }

  const labelIDs = new Set(authoritative.map((label) => label.labelId));
  const predictionIDs = new Set(byID.keys());
  if (
    labelIDs.size !== predictionIDs.size ||
    [...labelIDs].some((id) => !predictionIDs.has(id))
  ) {
    throw new Error('semantic v2 calibration replay label id set mismatch');
  }

  let executionProfileDigest: string | undefined;
  const samples = authoritative.map((label) => {
    const prediction = byID.get(label.labelId);
    if (prediction === undefined) {
      throw new Error(`missing semantic v2 prediction for label ${label.labelId}`);
    }
    if (prediction.sourceDigest !== label.sourceDigest) {
      throw new Error(`source identity mismatch for label ${label.labelId}`);
    }
    if (prediction.predicateId !== label.predicateId) {
      throw new Error(`predicate identity mismatch for label ${label.labelId}`);
    }
    if (
      executionProfileDigest !== undefined &&
      prediction.executionProfileDigest !== executionProfileDigest
    ) {
      throw new Error('semantic v2 calibration replay mixes execution profiles');
    }
    executionProfileDigest = prediction.executionProfileDigest;

    return Object.freeze({
      labelId: label.labelId,
      sourceDigest: label.sourceDigest,
      predicateId: label.predicateId,
      executionProfileDigest: prediction.executionProfileDigest,
      observationDigest: prediction.observationDigest,
      probability: prediction.probability,
      target: label.target,
    });
  });

  samples.sort((a, b) => a.labelId.localeCompare(b.labelId));
  return Object.freeze(samples);
}
