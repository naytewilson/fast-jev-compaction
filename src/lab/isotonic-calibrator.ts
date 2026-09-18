import { sha256Digest } from './recovery.js';
import type { CalibrationReplaySample } from './calibration-replay.js';
import type { Digest256 } from './identity.js';
import type { MappedObservationAxis } from './types.js';

export interface IsotonicCalibrationBlock {
  minRawProbability: number;
  maxRawProbability: number;
  calibratedProbability: number;
  sampleCount: number;
}

export interface IsotonicCalibrationModel {
  schema: 'anvil.isotonic-calibrator.v1';
  sampleCount: number;
  executionProfileDigest: Digest256;
  predicateId: MappedObservationAxis;
  blocks: readonly Readonly<IsotonicCalibrationBlock>[];
  calibratorSpecDigest: Digest256;
  fittedParametersDigest: Digest256;
}

interface WorkingBlock {
  minRawProbability: number;
  maxRawProbability: number;
  positiveCount: number;
  sampleCount: number;
}

function validateProbability(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError('probability must be finite in [0,1]');
  }
}

function mean(block: WorkingBlock): number {
  return block.positiveCount / block.sampleCount;
}

function merge(a: WorkingBlock, b: WorkingBlock): WorkingBlock {
  return {
    minRawProbability: a.minRawProbability,
    maxRawProbability: b.maxRawProbability,
    positiveCount: a.positiveCount + b.positiveCount,
    sampleCount: a.sampleCount + b.sampleCount,
  };
}

export function fitIsotonicCalibration(
  samples: readonly CalibrationReplaySample[],
): Readonly<IsotonicCalibrationModel> {
  if (samples.length === 0) {
    throw new TypeError('isotonic calibration requires at least one sample');
  }

  const first = samples[0];
  const executionProfileDigest = first.executionProfileDigest;
  const predicateId = first.predicateId;
  const sorted = [...samples].sort(
    (a, b) => a.probability - b.probability || a.labelId.localeCompare(b.labelId),
  );

  for (const sample of sorted) {
    validateProbability(sample.probability);
    if (sample.target !== 0 && sample.target !== 1) {
      throw new TypeError('calibration target must be 0 or 1');
    }
    if (sample.executionProfileDigest !== executionProfileDigest) {
      throw new Error('isotonic calibration mixes execution profiles');
    }
    if (sample.predicateId !== predicateId) {
      throw new Error('isotonic calibration mixes predicates');
    }
  }

  const grouped: WorkingBlock[] = [];
  for (const sample of sorted) {
    const previous = grouped[grouped.length - 1];
    if (
      previous !== undefined &&
      previous.minRawProbability === sample.probability &&
      previous.maxRawProbability === sample.probability
    ) {
      previous.positiveCount += sample.target;
      previous.sampleCount += 1;
    } else {
      grouped.push({
        minRawProbability: sample.probability,
        maxRawProbability: sample.probability,
        positiveCount: sample.target,
        sampleCount: 1,
      });
    }
  }

  const stack: WorkingBlock[] = [];
  for (const group of grouped) {
    stack.push({ ...group });
    while (
      stack.length >= 2 &&
      mean(stack[stack.length - 2]) > mean(stack[stack.length - 1])
    ) {
      const right = stack.pop()!;
      const left = stack.pop()!;
      stack.push(merge(left, right));
    }
  }

  const blocks = Object.freeze(
    stack.map((block) =>
      Object.freeze({
        minRawProbability: block.minRawProbability,
        maxRawProbability: block.maxRawProbability,
        calibratedProbability: mean(block),
        sampleCount: block.sampleCount,
      }),
    ),
  );

  const calibratorSpecDigest = sha256Digest(
    JSON.stringify({
      schema: 'anvil.isotonic-calibrator.v1',
      algorithm: 'pool-adjacent-violators',
      equalRawProbabilityPolicy: 'aggregate-before-pav',
      applyPolicy: 'piecewise-step-boundary-clamp',
    }),
  );

  const parameterCore = {
    schema: 'anvil.isotonic-calibrator.v1' as const,
    sampleCount: samples.length,
    executionProfileDigest,
    predicateId,
    blocks,
    calibratorSpecDigest,
  };
  const fittedParametersDigest = sha256Digest(JSON.stringify(parameterCore));

  return Object.freeze({
    ...parameterCore,
    fittedParametersDigest,
  });
}

export function applyIsotonicCalibration(
  model: IsotonicCalibrationModel,
  probability: number,
): number {
  validateProbability(probability);
  if (model.blocks.length === 0) {
    throw new Error('isotonic model has no blocks');
  }

  const first = model.blocks[0];
  const last = model.blocks[model.blocks.length - 1];
  if (probability <= first.minRawProbability) return first.calibratedProbability;
  if (probability >= last.maxRawProbability) return last.calibratedProbability;

  for (let index = 0; index < model.blocks.length; index += 1) {
    const block = model.blocks[index];
    if (probability <= block.maxRawProbability) {
      return block.calibratedProbability;
    }
    const next = model.blocks[index + 1];
    if (next !== undefined && probability < next.minRawProbability) {
      const midpoint = (block.maxRawProbability + next.minRawProbability) / 2;
      return probability <= midpoint
        ? block.calibratedProbability
        : next.calibratedProbability;
    }
  }
  return last.calibratedProbability;
}
