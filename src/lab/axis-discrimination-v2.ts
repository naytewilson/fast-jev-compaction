import type { SemanticReplayPredictionV2 } from './calibration-replay-v2.js';
import {
  mechanicalLabelTargetsV2,
} from './campaign-corpus-v2.js';
import {
  createToolRecoveryManifest,
} from './recovery.js';
import type { ReplayTrace } from './replay.js';
import {
  MODELED_SEMANTIC_AXES_V2,
  type ModeledSemanticAxisV2,
} from './semantic-contract-v2.js';
import type { SemanticCalibrationLabelV2 } from './semantic-label-v2.js';

export type AxisDiscriminationClassV2 =
  | 'ORDERING_GOOD_BIAS_ONLY'
  | 'OVERLAPPING_BUT_USABLE'
  | 'NON_DISCRIMINATING'
  | 'INVERTED';

export interface AxisDiscriminationAnchorV2 {
  id: string;
  primaryAxis: ModeledSemanticAxisV2;
  primaryTarget: 0 | 1;
  description: string;
}

interface AnchorSpec extends AxisDiscriminationAnchorV2 {
  mission: string;
  placement: 'head' | 'middle' | 'absent';
  stderr: string;
  exitStatus: number;
  includeUnresolvedMarker: boolean;
}

const ANCHORS: readonly AnchorSpec[] = Object.freeze([
  {
    id: 'axis-es-pos-01',
    primaryAxis: 'evidence_sufficient',
    primaryTarget: 1,
    description: 'decisive mission evidence is visible in the bounded head',
    mission: 'Verify the exact release marker is present.',
    placement: 'head',
    stderr: '',
    exitStatus: 0,
    includeUnresolvedMarker: false,
  },
  {
    id: 'axis-es-pos-02',
    primaryAxis: 'evidence_sufficient',
    primaryTarget: 1,
    description: 'second visible decisive marker proves bounded-view sufficiency',
    mission: 'Confirm the exact artifact identity is present.',
    placement: 'head',
    stderr: '',
    exitStatus: 0,
    includeUnresolvedMarker: false,
  },
  {
    id: 'axis-es-neg-01',
    primaryAxis: 'evidence_sufficient',
    primaryTarget: 0,
    description: 'decisive source evidence exists but is omitted from the bounded view',
    mission: 'Verify the exact release marker is present.',
    placement: 'middle',
    stderr: '',
    exitStatus: 0,
    includeUnresolvedMarker: false,
  },
  {
    id: 'axis-es-neg-02',
    primaryAxis: 'evidence_sufficient',
    primaryTarget: 0,
    description: 'second omitted decisive marker makes the bounded view insufficient',
    mission: 'Confirm the exact artifact identity is present.',
    placement: 'middle',
    stderr: '',
    exitStatus: 0,
    includeUnresolvedMarker: false,
  },

  {
    id: 'axis-sn-pos-01',
    primaryAxis: 'still_needed',
    primaryTarget: 1,
    description: 'candidate contains exact mission-relevant source evidence',
    mission: 'Find the required deployment token.',
    placement: 'head',
    stderr: '',
    exitStatus: 0,
    includeUnresolvedMarker: false,
  },
  {
    id: 'axis-sn-pos-02',
    primaryAxis: 'still_needed',
    primaryTarget: 1,
    description: 'second candidate contains exact mission-relevant source evidence',
    mission: 'Find the required source revision.',
    placement: 'head',
    stderr: '',
    exitStatus: 0,
    includeUnresolvedMarker: false,
  },
  {
    id: 'axis-sn-neg-01',
    primaryAxis: 'still_needed',
    primaryTarget: 0,
    description: 'candidate contains no mission-relevant critical evidence',
    mission: 'Find the required deployment token.',
    placement: 'absent',
    stderr: '',
    exitStatus: 0,
    includeUnresolvedMarker: false,
  },
  {
    id: 'axis-sn-neg-02',
    primaryAxis: 'still_needed',
    primaryTarget: 0,
    description: 'second candidate is orthogonal to the active mission',
    mission: 'Find the required source revision.',
    placement: 'absent',
    stderr: '',
    exitStatus: 0,
    includeUnresolvedMarker: false,
  },

  {
    id: 'axis-fcn-pos-01',
    primaryAxis: 'full_content_needed',
    primaryTarget: 1,
    description: 'important source evidence is omitted, so a reference alone loses immediate usefulness',
    mission: 'Verify the exact release marker before deciding.',
    placement: 'middle',
    stderr: '',
    exitStatus: 0,
    includeUnresolvedMarker: false,
  },
  {
    id: 'axis-fcn-pos-02',
    primaryAxis: 'full_content_needed',
    primaryTarget: 1,
    description: 'second omitted decisive span requires full source content now',
    mission: 'Verify the exact release marker before deciding.',
    placement: 'middle',
    stderr: '',
    exitStatus: 0,
    includeUnresolvedMarker: false,
  },
  {
    id: 'axis-fcn-neg-01',
    primaryAxis: 'full_content_needed',
    primaryTarget: 0,
    description: 'all decisive evidence is already visible; exact reference is sufficient for omitted filler',
    mission: 'Verify the exact release marker before deciding.',
    placement: 'head',
    stderr: '',
    exitStatus: 0,
    includeUnresolvedMarker: false,
  },
  {
    id: 'axis-fcn-neg-02',
    primaryAxis: 'full_content_needed',
    primaryTarget: 0,
    description: 'second bounded view already exposes the decisive evidence',
    mission: 'Verify the exact release marker before deciding.',
    placement: 'head',
    stderr: '',
    exitStatus: 0,
    includeUnresolvedMarker: false,
  },

  {
    id: 'axis-ue-pos-01',
    primaryAxis: 'unresolved_evidence',
    primaryTarget: 1,
    description: 'candidate contains a source-bound unresolved warning',
    mission: 'Determine whether unresolved review evidence exists.',
    placement: 'absent',
    stderr: 'warning: unresolved dependency requires review',
    exitStatus: 0,
    includeUnresolvedMarker: false,
  },
  {
    id: 'axis-ue-pos-02',
    primaryAxis: 'unresolved_evidence',
    primaryTarget: 1,
    description: 'candidate contains a source-bound verification contradiction',
    mission: 'Determine whether unresolved review evidence exists.',
    placement: 'absent',
    stderr: '',
    exitStatus: 0,
    includeUnresolvedMarker: true,
  },
  {
    id: 'axis-ue-neg-01',
    primaryAxis: 'unresolved_evidence',
    primaryTarget: 0,
    description: 'candidate contains no failure, warning, dependency, verification gap, or contradiction',
    mission: 'Determine whether unresolved review evidence exists.',
    placement: 'absent',
    stderr: '',
    exitStatus: 0,
    includeUnresolvedMarker: false,
  },
  {
    id: 'axis-ue-neg-02',
    primaryAxis: 'unresolved_evidence',
    primaryTarget: 0,
    description: 'missing mission evidence alone does not imply unresolved evidence',
    mission: 'Determine whether unresolved review evidence exists.',
    placement: 'middle',
    stderr: '',
    exitStatus: 0,
    includeUnresolvedMarker: false,
  },
]);

function anchorTrace(spec: AnchorSpec, ordinal: number): ReplayTrace {
  const headLines = 4;
  const tailLines = 4;
  const lineCount = 32;
  // Opaque identities prevent the evidence text from leaking the intended
  // axis or target class into the model-visible prompt.
  const nonce = String(ordinal).padStart(2, '0');
  const marker = `ANCHOR_MARKER_${nonce}`;
  const lines = Array.from(
    { length: lineCount },
    (_, index) => `audit step=${String(index).padStart(2, '0')} status=ok artifact=item-${index % 7}`,
  );
  lines[0] = `audit source_nonce=${nonce} status=ok artifact=anchor`;
  if (spec.placement === 'head') {
    lines[1] = `CRITICAL ${marker}`;
  } else if (spec.placement === 'middle') {
    lines[Math.floor(lineCount / 2)] = `CRITICAL ${marker}`;
  }
  if (spec.includeUnresolvedMarker) {
    // Keep this positive discriminator inside the bounded head. A hidden
    // contradiction would test unavailable source knowledge, not the axis.
    lines[2] = 'verification mismatch: expected digest differs from observed digest';
  }

  const stdout = lines.join('\n');
  const recovery = createToolRecoveryManifest(
    stdout,
    spec.stderr,
    spec.exitStatus,
    `axis-discrimination-${spec.id}`,
  );
  const criticalEvidence = spec.placement === 'absent'
    ? []
    : [`CRITICAL ${marker}`];

  return {
    trace_id: spec.id,
    source_run_id: `axis-discrimination-${spec.id}`,
    shared_state: spec.mission,
    candidates: [{
      candidate_id: `cand-${spec.id}`,
      stdout,
      stderr: spec.stderr,
      exit_status: spec.exitStatus,
      head_lines: headLines,
      tail_lines: tailLines,
      presentation_budget_bytes: 2048,
      recovery,
      critical_evidence: criticalEvidence,
    }],
  };
}

export function axisDiscriminationAnchorPlanV2(): readonly AxisDiscriminationAnchorV2[] {
  return Object.freeze(
    ANCHORS.map(({ id, primaryAxis, primaryTarget, description }) =>
      Object.freeze({ id, primaryAxis, primaryTarget, description })),
  );
}

export function axisDiscriminationCorpusV2(): readonly ReplayTrace[] {
  return Object.freeze(ANCHORS.map((spec, ordinal) => anchorTrace(spec, ordinal)));
}

export interface AxisDiscriminationCoverageV2 {
  positive: number;
  negative: number;
}

export function verifyAxisDiscriminationCorpusV2(
  traces: readonly ReplayTrace[],
): Readonly<Record<ModeledSemanticAxisV2, AxisDiscriminationCoverageV2>> {
  if (traces.length !== ANCHORS.length) {
    throw new Error(`axis discrimination corpus must contain exactly ${ANCHORS.length} anchors`);
  }

  const byTrace = new Map(traces.map((trace) => [trace.trace_id, trace]));
  if (byTrace.size !== traces.length) {
    throw new Error('axis discrimination corpus contains duplicate trace ids');
  }

  const sourceDigests = new Set<string>();
  const coverage = Object.fromEntries(
    MODELED_SEMANTIC_AXES_V2.map((axis) => [axis, { positive: 0, negative: 0 }]),
  ) as Record<ModeledSemanticAxisV2, AxisDiscriminationCoverageV2>;

  for (const spec of ANCHORS) {
    const trace = byTrace.get(spec.id);
    if (!trace || trace.candidates.length !== 1) {
      throw new Error(`axis discrimination anchor ${spec.id} must bind exactly one candidate`);
    }
    const candidate = trace.candidates[0];
    if (sourceDigests.has(candidate.recovery.source_digest)) {
      throw new Error('axis discrimination corpus contains duplicate source digests');
    }
    sourceDigests.add(candidate.recovery.source_digest);

    const targets = mechanicalLabelTargetsV2(candidate);
    if (targets[spec.primaryAxis] !== spec.primaryTarget) {
      throw new Error(
        `axis discrimination anchor ${spec.id} primary target drifted for ${spec.primaryAxis}`,
      );
    }
    for (const axis of MODELED_SEMANTIC_AXES_V2) {
      if (targets[axis] === 1) coverage[axis].positive += 1;
      else coverage[axis].negative += 1;
    }
  }

  for (const axis of MODELED_SEMANTIC_AXES_V2) {
    if (coverage[axis].positive < 2 || coverage[axis].negative < 2) {
      throw new Error(
        `axis discrimination corpus lacks >=2 positive and >=2 negative mechanical labels for ${axis}`,
      );
    }
  }

  return Object.freeze(
    Object.fromEntries(
      MODELED_SEMANTIC_AXES_V2.map((axis) => [
        axis,
        Object.freeze({ ...coverage[axis] }),
      ]),
    ) as Record<ModeledSemanticAxisV2, AxisDiscriminationCoverageV2>,
  );
}

export interface AxisDiscriminationMetricsV2 {
  positiveCount: number;
  negativeCount: number;
  positiveProbabilities: readonly number[];
  negativeProbabilities: readonly number[];
  positiveMean: number;
  negativeMean: number;
  positiveMin: number;
  positiveMax: number;
  negativeMin: number;
  negativeMax: number;
  minPositiveMinusMaxNegative: number;
  meanPositiveMinusMeanNegative: number;
  pairwiseOrderingRate: number;
  accuracyAt05: number;
  brier: number;
  classification: AxisDiscriminationClassV2;
}

export interface AxisDiscriminationReportV2 {
  schema: 'anvil.axis-discrimination-report.v2';
  axes: Readonly<Record<ModeledSemanticAxisV2, Readonly<AxisDiscriminationMetricsV2>>>;
  fullExpansionJustified: boolean;
  semanticsRepairAxes: readonly ModeledSemanticAxisV2[];
  providerFitBlockerAxes: readonly ModeledSemanticAxisV2[];
  nonAuthoritative: true;
  promotionAuthority: 'NONE';
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function classify(
  positives: readonly number[],
  negatives: readonly number[],
): AxisDiscriminationClassV2 {
  const posMean = mean(positives);
  const negMean = mean(negatives);
  const minPos = Math.min(...positives);
  const maxNeg = Math.max(...negatives);

  if (minPos > maxNeg) return 'ORDERING_GOOD_BIAS_ONLY';

  let wins = 0;
  let pairs = 0;
  for (const positive of positives) {
    for (const negative of negatives) {
      pairs += 1;
      if (positive > negative) wins += 1;
      else if (positive === negative) wins += 0.5;
    }
  }
  const ordering = wins / pairs;
  if (posMean < negMean && ordering < 0.5) return 'INVERTED';
  if (posMean > negMean && ordering >= 0.75) return 'OVERLAPPING_BUT_USABLE';
  return 'NON_DISCRIMINATING';
}

export function analyzeAxisDiscriminationV2(input: {
  labels: readonly SemanticCalibrationLabelV2[];
  predictions: readonly SemanticReplayPredictionV2[];
}): Readonly<AxisDiscriminationReportV2> {
  const strongLabels = input.labels.filter((label) => label.authority === 'STRONG');
  if (strongLabels.length === 0) {
    throw new Error('axis discrimination requires STRONG mechanical labels');
  }
  if (input.predictions.length !== strongLabels.length) {
    throw new Error('axis discrimination prediction/label cardinality mismatch');
  }

  const labelsByID = new Map<string, SemanticCalibrationLabelV2>();
  for (const label of strongLabels) {
    if (labelsByID.has(label.labelId)) {
      throw new Error(`duplicate axis discrimination label ${label.labelId}`);
    }
    labelsByID.set(label.labelId, label);
  }

  const predictionsByID = new Map<string, SemanticReplayPredictionV2>();
  for (const prediction of input.predictions) {
    if (predictionsByID.has(prediction.labelId)) {
      throw new Error(`duplicate axis discrimination prediction ${prediction.labelId}`);
    }
    const label = labelsByID.get(prediction.labelId);
    if (!label) {
      throw new Error(`axis discrimination prediction has unknown label ${prediction.labelId}`);
    }
    if (
      prediction.predicateId !== label.predicateId ||
      prediction.sourceDigest !== label.sourceDigest
    ) {
      throw new Error(`axis discrimination prediction identity mismatch for ${prediction.labelId}`);
    }
    if (
      !Number.isFinite(prediction.probability) ||
      prediction.probability < 0 ||
      prediction.probability > 1
    ) {
      throw new Error(`axis discrimination probability out of range for ${prediction.labelId}`);
    }
    predictionsByID.set(prediction.labelId, prediction);
  }

  const axes = {} as Record<ModeledSemanticAxisV2, Readonly<AxisDiscriminationMetricsV2>>;
  const semanticsRepairAxes: ModeledSemanticAxisV2[] = [];
  const providerFitBlockerAxes: ModeledSemanticAxisV2[] = [];

  for (const axis of MODELED_SEMANTIC_AXES_V2) {
    const axisLabels = strongLabels.filter((label) => label.predicateId === axis);
    const positives = axisLabels
      .filter((label) => label.target === 1)
      .map((label) => predictionsByID.get(label.labelId)!.probability);
    const negatives = axisLabels
      .filter((label) => label.target === 0)
      .map((label) => predictionsByID.get(label.labelId)!.probability);

    if (positives.length < 2 || negatives.length < 2) {
      throw new Error(`axis discrimination lacks >=2 positive and >=2 negative predictions for ${axis}`);
    }

    let orderedWins = 0;
    let pairs = 0;
    for (const positive of positives) {
      for (const negative of negatives) {
        pairs += 1;
        if (positive > negative) orderedWins += 1;
        else if (positive === negative) orderedWins += 0.5;
      }
    }

    let correct = 0;
    let squaredError = 0;
    for (const label of axisLabels) {
      const probability = predictionsByID.get(label.labelId)!.probability;
      if ((probability >= 0.5 ? 1 : 0) === label.target) correct += 1;
      squaredError += (probability - label.target) ** 2;
    }

    const classification = classify(positives, negatives);
    const metrics: AxisDiscriminationMetricsV2 = {
      positiveCount: positives.length,
      negativeCount: negatives.length,
      positiveProbabilities: Object.freeze([...positives]),
      negativeProbabilities: Object.freeze([...negatives]),
      positiveMean: mean(positives),
      negativeMean: mean(negatives),
      positiveMin: Math.min(...positives),
      positiveMax: Math.max(...positives),
      negativeMin: Math.min(...negatives),
      negativeMax: Math.max(...negatives),
      minPositiveMinusMaxNegative: Math.min(...positives) - Math.max(...negatives),
      meanPositiveMinusMeanNegative: mean(positives) - mean(negatives),
      pairwiseOrderingRate: orderedWins / pairs,
      accuracyAt05: correct / axisLabels.length,
      brier: squaredError / axisLabels.length,
      classification,
    };
    axes[axis] = Object.freeze(metrics);

    if (
      (axis === 'full_content_needed' || axis === 'unresolved_evidence') &&
      (classification === 'NON_DISCRIMINATING' || classification === 'INVERTED')
    ) {
      semanticsRepairAxes.push(axis);
    }
    if (
      (axis === 'evidence_sufficient' || axis === 'still_needed') &&
      (classification === 'NON_DISCRIMINATING' || classification === 'INVERTED')
    ) {
      providerFitBlockerAxes.push(axis);
    }
  }

  const fullExpansionJustified =
    semanticsRepairAxes.length === 0 &&
    providerFitBlockerAxes.length === 0 &&
    MODELED_SEMANTIC_AXES_V2.every((axis) =>
      axes[axis].classification === 'ORDERING_GOOD_BIAS_ONLY' ||
      axes[axis].classification === 'OVERLAPPING_BUT_USABLE');

  return Object.freeze({
    schema: 'anvil.axis-discrimination-report.v2' as const,
    axes: Object.freeze(axes),
    fullExpansionJustified,
    semanticsRepairAxes: Object.freeze(semanticsRepairAxes),
    providerFitBlockerAxes: Object.freeze(providerFitBlockerAxes),
    nonAuthoritative: true as const,
    promotionAuthority: 'NONE' as const,
  });
}
