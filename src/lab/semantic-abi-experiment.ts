import {
  MAPPED_OBSERVATION_AXES,
  type MappedDecisionRequest,
  type MappedObservationAxis,
} from './types.js';
import {
  buildSystemOneMappedPayload,
  type SystemOneMappedPayload,
} from './system-one-adapter.js';

export const FIVE_AXIS_EXPERIMENT_AXES =
  Object.freeze([...MAPPED_OBSERVATION_AXES]) as readonly MappedObservationAxis[];

export const FOUR_AXIS_EXPERIMENT_AXES = Object.freeze([
  'evidence_sufficient',
  'still_needed',
  'full_content_needed',
  'unresolved_evidence',
] as const);

export type FourAxisExperimentAxis =
  (typeof FOUR_AXIS_EXPERIMENT_AXES)[number];

export interface AxisExperimentObservation {
  candidateId: string;
  values: Readonly<Partial<Record<MappedObservationAxis, number>>>;
}

export interface SharedAxisDelta {
  candidateId: string;
  axis: FourAxisExperimentAxis;
  fiveAxisProbability: number;
  fourAxisProbability: number;
  absoluteDelta: number;
}

const KNOWN_AXES = new Set<MappedObservationAxis>(MAPPED_OBSERVATION_AXES);

function assertAxisSet(axes: readonly MappedObservationAxis[]): void {
  if (axes.length === 0) {
    throw new TypeError('axis set must not be empty');
  }
  const seen = new Set<MappedObservationAxis>();
  for (const axis of axes) {
    if (!KNOWN_AXES.has(axis)) {
      throw new TypeError(`unknown observation axis: ${axis}`);
    }
    if (seen.has(axis)) {
      throw new TypeError(`duplicate observation axis: ${axis}`);
    }
    seen.add(axis);
  }
}

function probability(value: unknown, axis: string, candidateId: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new TypeError(
      `axis ${axis} for candidate ${candidateId} must be finite in [0,1]`,
    );
  }
  return value;
}

function observationMap(
  label: string,
  observations: readonly AxisExperimentObservation[],
): Map<string, AxisExperimentObservation> {
  const byID = new Map<string, AxisExperimentObservation>();
  for (const observation of observations) {
    if (observation.candidateId.length === 0) {
      throw new TypeError(`${label} candidate ID must not be empty`);
    }
    if (byID.has(observation.candidateId)) {
      throw new TypeError(
        `${label} contains duplicate candidate ${observation.candidateId}`,
      );
    }
    byID.set(observation.candidateId, observation);
  }
  return byID;
}

export function observationQuestionCount(
  candidateCount: number,
  axes: readonly MappedObservationAxis[],
): number {
  if (!Number.isSafeInteger(candidateCount) || candidateCount < 0) {
    throw new TypeError('candidate count must be a non-negative safe integer');
  }
  assertAxisSet(axes);
  return candidateCount * axes.length;
}

export function compareSharedAxisObservations(
  fiveAxis: readonly AxisExperimentObservation[],
  fourAxis: readonly AxisExperimentObservation[],
): readonly SharedAxisDelta[] {
  const fiveByID = observationMap('five-axis arm', fiveAxis);
  const fourByID = observationMap('four-axis arm', fourAxis);

  const fiveIDs = [...fiveByID.keys()].sort();
  const fourIDs = [...fourByID.keys()].sort();
  if (
    fiveIDs.length !== fourIDs.length ||
    fiveIDs.some((id, index) => id !== fourIDs[index])
  ) {
    throw new Error('candidate sets do not match across experiment arms');
  }

  const deltas: SharedAxisDelta[] = [];
  for (const candidateId of fiveIDs) {
    const five = fiveByID.get(candidateId)!;
    const four = fourByID.get(candidateId)!;
    for (const axis of FOUR_AXIS_EXPERIMENT_AXES) {
      const fiveProbability = probability(
        five.values[axis],
        axis,
        candidateId,
      );
      const fourProbability = probability(
        four.values[axis],
        axis,
        candidateId,
      );
      deltas.push(Object.freeze({
        candidateId,
        axis,
        fiveAxisProbability: fiveProbability,
        fourAxisProbability: fourProbability,
        absoluteDelta: Number(
          Math.abs(fiveProbability - fourProbability).toFixed(15),
        ),
      }));
    }
  }

  return Object.freeze(deltas);
}


export type SystemOneAxisExperimentPayload = SystemOneMappedPayload;

export interface SystemOneAxisExperimentResult {
  observations: readonly AxisExperimentObservation[];
  providerMetadata: {
    requested_model: string;
    effective_model: string;
    input_tokens: number | null;
    output_tokens: number | null;
    cost_usd: null;
  };
}

export function buildSystemOneAxisExperimentPayload(
  request: MappedDecisionRequest,
  model: string,
  axes: readonly MappedObservationAxis[],
): SystemOneAxisExperimentPayload {
  assertAxisSet(axes);
  return buildSystemOneMappedPayload(request, model, axes);
}

function optionalUsage(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function parseSystemOneAxisExperimentResponse(
  request: MappedDecisionRequest,
  model: string,
  axes: readonly MappedObservationAxis[],
  responseText: string,
): SystemOneAxisExperimentResult {
  assertAxisSet(axes);
  const payload = buildSystemOneMappedPayload(request, model, axes);
  const expectedKeys = Object.keys(payload.questions);

  let parsed: any;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error('System One axis experiment returned malformed JSON');
  }

  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    parsed.answers === null ||
    typeof parsed.answers !== 'object' ||
    Array.isArray(parsed.answers)
  ) {
    throw new Error('System One axis experiment response is missing answers');
  }

  if (typeof parsed.model === 'string' && parsed.model !== model) {
    throw new Error('System One axis experiment effective model does not match the pinned model');
  }

  const actualKeys = Object.keys(parsed.answers);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key) => !Object.prototype.hasOwnProperty.call(payload.questions, key))
  ) {
    throw new Error('System One axis experiment answer key set does not exactly match the requested axes');
  }

  const observations: AxisExperimentObservation[] = request.candidate_views.map((candidate) => {
    const values: Partial<Record<MappedObservationAxis, number>> = {};
    for (const axis of axes) {
      const key = `${candidate.candidate_id}.${axis}`;
      values[axis] = probability(
        parsed.answers[key]?.noul,
        axis,
        candidate.candidate_id,
      );
    }
    return {
      candidateId: candidate.candidate_id,
      values: Object.freeze(values),
    };
  });

  return {
    observations: Object.freeze(observations),
    providerMetadata: {
      requested_model: model,
      effective_model: typeof parsed.model === 'string' ? parsed.model : model,
      input_tokens: optionalUsage(parsed.usage?.input_tokens),
      output_tokens: optionalUsage(parsed.usage?.output_tokens),
      cost_usd: null,
    },
  };
}
