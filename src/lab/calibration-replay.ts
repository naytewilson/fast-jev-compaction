import type { Digest256 } from './identity.js';
import {
  selectAuthoritativeSemanticLabels,
  type SemanticCalibrationLabel,
} from './semantic-label.js';
import type { MappedObservationAxis } from './types.js';

export interface SemanticReplayPrediction {
  labelId: string;
  predicateId: MappedObservationAxis;
  sourceDigest: Digest256;
  executionProfileDigest: Digest256;
  observationDigest: Digest256;
  probability: number;
}

export interface CalibrationReplaySample {
  labelId: string;
  sourceDigest: Digest256;
  predicateId: MappedObservationAxis;
  executionProfileDigest: Digest256;
  observationDigest: Digest256;
  probability: number;
  target: 0 | 1;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;

function validatePrediction(prediction: SemanticReplayPrediction): void {
  if (prediction.labelId.length === 0) {
    throw new TypeError('prediction labelId must be non-empty');
  }
  for (const [field, value] of [
    ['sourceDigest', prediction.sourceDigest],
    ['executionProfileDigest', prediction.executionProfileDigest],
    ['observationDigest', prediction.observationDigest],
  ] as const) {
    if (!DIGEST.test(value)) throw new TypeError(`${field} must be canonical sha256`);
  }
  if (
    !Number.isFinite(prediction.probability) ||
    prediction.probability < 0 ||
    prediction.probability > 1
  ) {
    throw new TypeError('prediction probability must be finite in [0,1]');
  }
}

export function joinCalibrationReplay(
  labels: readonly SemanticCalibrationLabel[],
  predictions: readonly SemanticReplayPrediction[],
): readonly Readonly<CalibrationReplaySample>[] {
  if (labels.some((label) => label.authority !== 'STRONG')) {
    throw new Error('authoritative calibration replay accepts STRONG labels only');
  }
  const authoritative = selectAuthoritativeSemanticLabels(labels);
  if (authoritative.length !== predictions.length) {
    throw new Error('calibration replay cardinality mismatch');
  }

  const byId = new Map<string, SemanticReplayPrediction>();
  for (const prediction of predictions) {
    validatePrediction(prediction);
    if (byId.has(prediction.labelId)) {
      throw new Error(`duplicate prediction label id ${prediction.labelId}`);
    }
    byId.set(prediction.labelId, prediction);
  }

  const labelIds = new Set(authoritative.map((label) => label.labelId));
  const predictionIds = new Set(byId.keys());
  if (
    labelIds.size !== predictionIds.size ||
    [...labelIds].some((id) => !predictionIds.has(id))
  ) {
    throw new Error('calibration replay label id set mismatch');
  }

  let executionProfileDigest: string | undefined;
  const samples = authoritative.map((label) => {
    const prediction = byId.get(label.labelId);
    if (prediction === undefined) {
      throw new Error(`missing prediction for label ${label.labelId}`);
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
      throw new Error('calibration replay mixes execution profiles');
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
