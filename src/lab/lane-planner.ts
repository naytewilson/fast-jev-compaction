import {
  assertAuthorityPreservingAcceleration,
  type SemanticAuthorityMask,
} from './authority-mask.js';

export interface SemanticLane {
  originalOrdinal: number;
  candidateId: string;
  sourceDigest: string;
  tokenEstimate: number;
  mask: SemanticAuthorityMask;
}

export interface SemanticMicrobatchConfig {
  shapeBuckets: readonly number[];
  maxBatchSize: number;
}

export interface PackedSemanticLane extends SemanticLane {
  packedIndex: number;
  shapeBucket: number;
}

export interface SemanticMicrobatch {
  shapeBucket: number;
  lanes: readonly PackedSemanticLane[];
}

export interface SemanticMicrobatchPlan {
  schema: 'anvil.semantic-microbatch-plan.v1';
  sourceLaneCount: number;
  packedLanes: readonly PackedSemanticLane[];
  batches: readonly SemanticMicrobatch[];
}

export interface PackedLaneResult<T> {
  packedIndex: number;
  candidateId: string;
  value: T;
}

export interface ReassembledLaneResult<T> {
  originalOrdinal: number;
  candidateId: string;
  value: T;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;

function requireSafeNonNegative(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
}

function validateConfig(config: SemanticMicrobatchConfig): void {
  if (!Number.isSafeInteger(config.maxBatchSize) || config.maxBatchSize <= 0) {
    throw new TypeError('maxBatchSize must be a positive safe integer');
  }
  if (config.shapeBuckets.length === 0) {
    throw new TypeError('shapeBuckets must not be empty');
  }

  let previous = 0;
  for (const bucket of config.shapeBuckets) {
    if (!Number.isSafeInteger(bucket) || bucket <= 0) {
      throw new TypeError('shapeBuckets must contain positive safe integers');
    }
    if (bucket <= previous) {
      throw new TypeError('shapeBuckets must be strictly increasing and unique');
    }
    previous = bucket;
  }
}

function bucketFor(tokenEstimate: number, buckets: readonly number[]): number {
  return buckets.find((bucket) => bucket >= tokenEstimate) ?? Math.max(1, tokenEstimate);
}

function copyMask(mask: SemanticAuthorityMask): SemanticAuthorityMask {
  return Object.freeze({
    source: mask.source,
    evidence: mask.evidence,
    calibration: mask.calibration,
    authority: mask.authority,
    recovery: mask.recovery,
  });
}

export function planSemanticMicrobatches(
  lanes: readonly SemanticLane[],
  config: SemanticMicrobatchConfig,
): SemanticMicrobatchPlan {
  validateConfig(config);

  const ordinals = new Set<number>();
  const candidateIDs = new Set<string>();

  const eligible = lanes.flatMap((lane) => {
    requireSafeNonNegative(lane.originalOrdinal, 'originalOrdinal');
    requireSafeNonNegative(lane.tokenEstimate, 'tokenEstimate');

    if (lane.candidateId.length === 0) {
      throw new TypeError('candidateId must be non-empty');
    }
    if (!DIGEST.test(lane.sourceDigest)) {
      throw new TypeError('sourceDigest must be canonical sha256');
    }
    if (ordinals.has(lane.originalOrdinal)) {
      throw new Error(`duplicate ordinal ${lane.originalOrdinal}`);
    }
    if (candidateIDs.has(lane.candidateId)) {
      throw new Error(`duplicate candidate id ${lane.candidateId}`);
    }
    ordinals.add(lane.originalOrdinal);
    candidateIDs.add(lane.candidateId);

    if (!lane.mask.source) return [];

    const preservedMask = copyMask(lane.mask);
    assertAuthorityPreservingAcceleration(lane.mask, preservedMask);

    return [{
      originalOrdinal: lane.originalOrdinal,
      candidateId: lane.candidateId,
      sourceDigest: lane.sourceDigest,
      tokenEstimate: lane.tokenEstimate,
      mask: preservedMask,
      shapeBucket: bucketFor(lane.tokenEstimate, config.shapeBuckets),
    }];
  });

  eligible.sort(
    (a, b) => a.shapeBucket - b.shapeBucket || a.originalOrdinal - b.originalOrdinal,
  );

  const packedLanes: PackedSemanticLane[] = eligible.map((lane, packedIndex) =>
    Object.freeze({ ...lane, packedIndex }),
  );

  const batches: SemanticMicrobatch[] = [];
  let cursor = 0;
  while (cursor < packedLanes.length) {
    const shapeBucket = packedLanes[cursor].shapeBucket;
    let endOfBucket = cursor;
    while (
      endOfBucket < packedLanes.length &&
      packedLanes[endOfBucket].shapeBucket === shapeBucket
    ) {
      endOfBucket += 1;
    }

    for (let start = cursor; start < endOfBucket; start += config.maxBatchSize) {
      batches.push(Object.freeze({
        shapeBucket,
        lanes: Object.freeze(
          packedLanes.slice(start, Math.min(start + config.maxBatchSize, endOfBucket)),
        ),
      }));
    }
    cursor = endOfBucket;
  }

  return Object.freeze({
    schema: 'anvil.semantic-microbatch-plan.v1',
    sourceLaneCount: lanes.length,
    packedLanes: Object.freeze(packedLanes),
    batches: Object.freeze(batches),
  });
}

export function reassemblePackedLaneResults<T>(
  plan: SemanticMicrobatchPlan,
  results: readonly PackedLaneResult<T>[],
): ReassembledLaneResult<T>[] {
  if (results.length !== plan.packedLanes.length) {
    throw new Error('packed result cardinality mismatch');
  }

  const byPackedIndex = new Map<number, PackedLaneResult<T>>();
  for (const result of results) {
    requireSafeNonNegative(result.packedIndex, 'packedIndex');
    if (byPackedIndex.has(result.packedIndex)) {
      throw new Error(`duplicate packed index ${result.packedIndex}`);
    }

    const planned = plan.packedLanes[result.packedIndex];
    if (planned === undefined) {
      throw new Error(`unknown packed index ${result.packedIndex}`);
    }
    if (result.candidateId !== planned.candidateId) {
      throw new Error(
        `candidate identity mismatch at packed index ${result.packedIndex}`,
      );
    }
    byPackedIndex.set(result.packedIndex, result);
  }

  const reassembled = plan.packedLanes.map((planned) => {
    const result = byPackedIndex.get(planned.packedIndex);
    if (result === undefined) {
      throw new Error(`missing packed index ${planned.packedIndex}`);
    }
    return {
      originalOrdinal: planned.originalOrdinal,
      candidateId: planned.candidateId,
      value: result.value,
    };
  });

  return reassembled.sort((a, b) => a.originalOrdinal - b.originalOrdinal);
}
