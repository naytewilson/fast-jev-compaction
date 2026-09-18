import {
  MODELED_SEMANTIC_AXES_V2,
  type ModeledSemanticAxisV2,
} from './semantic-contract-v2.js';

export const AXIS_ISOLATE_ANSWERABILITY_FLOOR_V2 = 0.5;

export interface AxisIsolateAnchorV2 {
  id: string;
  primaryAxis: ModeledSemanticAxisV2;
  primaryTarget: 0 | 1;
}

export interface AxisIsolateSourceManifestRowV2 {
  schema: 'anvil.noul-manifest.v2';
  requestId: string;
  traceId: string;
  candidateId: string;
  sourceDigest: string;
  candidateViewDigest: string;
  axisSpecDigest: string;
  prompts: Record<ModeledSemanticAxisV2, string>;
}

export interface AxisIsolateManifestRowV2 {
  schema: 'anvil.axis-isolate-manifest.v2';
  requestId: string;
  traceId: string;
  candidateId: string;
  sourceDigest: string;
  candidateViewDigest: string;
  axisSpecDigest: string;
  axis: ModeledSemanticAxisV2;
  target: 0 | 1;
  prompt: string;
}

export interface AxisIsolateObservationV2 {
  schema: 'anvil.axis-isolate-observation.v2';
  requestId: string;
  candidateId: string;
  candidateViewDigest: string;
  providerProfileDigest: string;
  axisSpecDigest: string;
  axis: ModeledSemanticAxisV2;
  probability: number;
  yesAbs: number;
  noAbs: number;
  answerTokenMass: number;
  promptDigest: string;
  timingMs: number;
}

export interface ParentAxisObservationV2 {
  candidateId: string;
  axisProbabilities: Record<ModeledSemanticAxisV2, number>;
  telemetry: Record<
    ModeledSemanticAxisV2,
    {
      abs?: Record<string, number>;
    }
  >;
}

export type AxisIsolateOrderingClassV2 =
  | 'ORDERING_GOOD_BIAS_ONLY'
  | 'OVERLAPPING_BUT_USABLE'
  | 'NON_DISCRIMINATING'
  | 'INVERTED';

export interface AxisIsolateMetricsV2 {
  positiveCount: number;
  negativeCount: number;
  positiveProbabilities: readonly number[];
  negativeProbabilities: readonly number[];
  positiveMean: number;
  negativeMean: number;
  minPositiveMinusMaxNegative: number;
  meanPositiveMinusMeanNegative: number;
  pairwiseOrderingRate: number;
  classification: AxisIsolateOrderingClassV2;
  answerTokenMass: {
    values: readonly number[];
    min: number;
    mean: number;
    max: number;
    allAboveFloor: boolean;
  };
  parentAnswerTokenMass: {
    values: readonly number[];
    min: number;
    mean: number;
    max: number;
  };
  answerTokenMassGainMean: number;
}

export interface AxisIsolateReportV2 {
  schema: 'anvil.axis-isolate-report.v2';
  answerabilityFloor: number;
  axes: Readonly<Record<ModeledSemanticAxisV2, Readonly<AxisIsolateMetricsV2>>>;
  allRowsAnswerable: boolean;
  decision:
    | 'HARNESS_STILL_INVALID_LOW_ANSWER_MASS'
    | 'HARNESS_REPAIRED_AXES_DISCRIMINATE'
    | 'HARNESS_REPAIRED_SEMANTIC_FAILURE_PERSISTS';
  nonAuthoritative: true;
  promotionAuthority: 'NONE';
}

const YES_TOKEN_IDS = ['11683', '12447', '18171', '17550'] as const;
const NO_TOKEN_IDS = ['2243', '4547', '794', '2752'] as const;

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function classify(
  positives: readonly number[],
  negatives: readonly number[],
): AxisIsolateOrderingClassV2 {
  const positiveMean = mean(positives);
  const negativeMean = mean(negatives);
  const minPositive = Math.min(...positives);
  const maxNegative = Math.max(...negatives);
  if (minPositive > maxNegative) return 'ORDERING_GOOD_BIAS_ONLY';

  let wins = 0;
  let pairs = 0;
  for (const positive of positives) {
    for (const negative of negatives) {
      pairs += 1;
      if (positive > negative) wins += 1;
      else if (positive === negative) wins += 0.5;
    }
  }
  const rate = wins / pairs;
  if (positiveMean < negativeMean && rate < 0.5) return 'INVERTED';
  if (positiveMean > negativeMean && rate >= 0.75) return 'OVERLAPPING_BUT_USABLE';
  return 'NON_DISCRIMINATING';
}

function parentAnswerMass(
  observation: ParentAxisObservationV2,
  axis: ModeledSemanticAxisV2,
): number {
  const abs = observation.telemetry[axis]?.abs ?? {};
  const yes = YES_TOKEN_IDS.reduce((sum, id) => sum + (abs[id] ?? 0), 0);
  const no = NO_TOKEN_IDS.reduce((sum, id) => sum + (abs[id] ?? 0), 0);
  return yes + no;
}

export function buildAxisIsolateManifestV2(input: {
  sourceRows: readonly AxisIsolateSourceManifestRowV2[];
  anchors: readonly AxisIsolateAnchorV2[];
}): readonly AxisIsolateManifestRowV2[] {
  if (input.sourceRows.length !== 16 || input.anchors.length !== 16) {
    throw new Error('axis isolate requires exactly 16 source rows and 16 anchors');
  }

  const sourceByTrace = new Map(input.sourceRows.map((row) => [row.traceId, row]));
  const seenCandidates = new Set<string>();
  const rows: AxisIsolateManifestRowV2[] = [];

  for (const anchor of input.anchors) {
    const source = sourceByTrace.get(anchor.id);
    if (!source) throw new Error(`axis isolate missing source row for ${anchor.id}`);
    if (source.schema !== 'anvil.noul-manifest.v2') {
      throw new Error(`axis isolate source row schema mismatch for ${anchor.id}`);
    }
    if (seenCandidates.has(source.candidateId)) {
      throw new Error(`axis isolate duplicate candidate ${source.candidateId}`);
    }
    seenCandidates.add(source.candidateId);
    const prompt = source.prompts?.[anchor.primaryAxis];
    if (!prompt) {
      throw new Error(
        `axis isolate source row ${anchor.id} lacks prompt for ${anchor.primaryAxis}`,
      );
    }
    rows.push({
      schema: 'anvil.axis-isolate-manifest.v2',
      requestId: source.requestId,
      traceId: source.traceId,
      candidateId: source.candidateId,
      sourceDigest: source.sourceDigest,
      candidateViewDigest: source.candidateViewDigest,
      axisSpecDigest: source.axisSpecDigest,
      axis: anchor.primaryAxis,
      target: anchor.primaryTarget,
      prompt,
    });
  }

  for (const axis of MODELED_SEMANTIC_AXES_V2) {
    const axisRows = rows.filter((row) => row.axis === axis);
    const positives = axisRows.filter((row) => row.target === 1).length;
    const negatives = axisRows.filter((row) => row.target === 0).length;
    if (axisRows.length !== 4 || positives !== 2 || negatives !== 2) {
      throw new Error(
        `axis isolate requires exactly 2 positive and 2 negative primary anchors for ${axis}`,
      );
    }
  }

  return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
}

export function analyzeAxisIsolateV2(input: {
  manifest: readonly AxisIsolateManifestRowV2[];
  observations: readonly AxisIsolateObservationV2[];
  parentObservations: readonly ParentAxisObservationV2[];
  answerabilityFloor?: number;
}): Readonly<AxisIsolateReportV2> {
  const floor = input.answerabilityFloor ?? AXIS_ISOLATE_ANSWERABILITY_FLOOR_V2;
  if (!Number.isFinite(floor) || floor <= 0 || floor >= 1) {
    throw new Error('axis isolate answerability floor must be between 0 and 1');
  }
  if (input.manifest.length !== 16 || input.observations.length !== 16) {
    throw new Error('axis isolate requires exactly 16 manifest and observation rows');
  }

  const manifestByCandidate = new Map<string, AxisIsolateManifestRowV2>();
  for (const row of input.manifest) {
    if (manifestByCandidate.has(row.candidateId)) {
      throw new Error(`axis isolate duplicate manifest candidate ${row.candidateId}`);
    }
    manifestByCandidate.set(row.candidateId, row);
  }
  const parentByCandidate = new Map(
    input.parentObservations.map((row) => [row.candidateId, row]),
  );

  const observationByCandidate = new Map<string, AxisIsolateObservationV2>();
  for (const observation of input.observations) {
    if (observationByCandidate.has(observation.candidateId)) {
      throw new Error(
        `axis isolate duplicate observation candidate ${observation.candidateId}`,
      );
    }
    const row = manifestByCandidate.get(observation.candidateId);
    if (!row) {
      throw new Error(
        `axis isolate observation has unknown candidate ${observation.candidateId}`,
      );
    }
    if (
      observation.axis !== row.axis ||
      observation.requestId !== row.requestId ||
      observation.candidateViewDigest !== row.candidateViewDigest ||
      observation.axisSpecDigest !== row.axisSpecDigest
    ) {
      throw new Error(
        `axis isolate observation identity mismatch for ${observation.candidateId}`,
      );
    }
    if (
      !Number.isFinite(observation.probability) ||
      observation.probability < 0 ||
      observation.probability > 1 ||
      !Number.isFinite(observation.answerTokenMass) ||
      observation.answerTokenMass < 0 ||
      observation.answerTokenMass > 1
    ) {
      throw new Error(
        `axis isolate observation probability/mass invalid for ${observation.candidateId}`,
      );
    }
    observationByCandidate.set(observation.candidateId, observation);
  }

  const axes = {} as Record<ModeledSemanticAxisV2, Readonly<AxisIsolateMetricsV2>>;
  let allRowsAnswerable = true;

  for (const axis of MODELED_SEMANTIC_AXES_V2) {
    const axisRows = input.manifest.filter((row) => row.axis === axis);
    if (
      axisRows.length !== 4 ||
      axisRows.filter((row) => row.target === 1).length !== 2 ||
      axisRows.filter((row) => row.target === 0).length !== 2
    ) {
      throw new Error(`axis isolate manifest coverage invalid for ${axis}`);
    }

    const positives = axisRows
      .filter((row) => row.target === 1)
      .map((row) => observationByCandidate.get(row.candidateId)!.probability);
    const negatives = axisRows
      .filter((row) => row.target === 0)
      .map((row) => observationByCandidate.get(row.candidateId)!.probability);
    const masses = axisRows.map(
      (row) => observationByCandidate.get(row.candidateId)!.answerTokenMass,
    );
    const parentMasses = axisRows.map((row) => {
      const parent = parentByCandidate.get(row.candidateId);
      if (!parent) {
        throw new Error(
          `axis isolate missing parent observation for ${row.candidateId}`,
        );
      }
      return parentAnswerMass(parent, axis);
    });

    let wins = 0;
    let pairs = 0;
    for (const positive of positives) {
      for (const negative of negatives) {
        pairs += 1;
        if (positive > negative) wins += 1;
        else if (positive === negative) wins += 0.5;
      }
    }

    const allAboveFloor = masses.every((value) => value >= floor);
    if (!allAboveFloor) allRowsAnswerable = false;

    axes[axis] = Object.freeze({
      positiveCount: positives.length,
      negativeCount: negatives.length,
      positiveProbabilities: Object.freeze([...positives]),
      negativeProbabilities: Object.freeze([...negatives]),
      positiveMean: mean(positives),
      negativeMean: mean(negatives),
      minPositiveMinusMaxNegative: Math.min(...positives) - Math.max(...negatives),
      meanPositiveMinusMeanNegative: mean(positives) - mean(negatives),
      pairwiseOrderingRate: wins / pairs,
      classification: classify(positives, negatives),
      answerTokenMass: Object.freeze({
        values: Object.freeze([...masses]),
        min: Math.min(...masses),
        mean: mean(masses),
        max: Math.max(...masses),
        allAboveFloor,
      }),
      parentAnswerTokenMass: Object.freeze({
        values: Object.freeze([...parentMasses]),
        min: Math.min(...parentMasses),
        mean: mean(parentMasses),
        max: Math.max(...parentMasses),
      }),
      answerTokenMassGainMean: mean(masses) - mean(parentMasses),
    });
  }

  const allAxesDiscriminate = MODELED_SEMANTIC_AXES_V2.every((axis) =>
    axes[axis].classification === 'ORDERING_GOOD_BIAS_ONLY' ||
    axes[axis].classification === 'OVERLAPPING_BUT_USABLE');

  return Object.freeze({
    schema: 'anvil.axis-isolate-report.v2' as const,
    answerabilityFloor: floor,
    axes: Object.freeze(axes),
    allRowsAnswerable,
    decision: !allRowsAnswerable
      ? 'HARNESS_STILL_INVALID_LOW_ANSWER_MASS'
      : allAxesDiscriminate
        ? 'HARNESS_REPAIRED_AXES_DISCRIMINATE'
        : 'HARNESS_REPAIRED_SEMANTIC_FAILURE_PERSISTS',
    nonAuthoritative: true as const,
    promotionAuthority: 'NONE' as const,
  });
}
