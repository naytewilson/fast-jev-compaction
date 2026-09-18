import {
  MAPPED_OBSERVATION_AXES,
  type MappedObservationAxis,
} from './types.js';

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

export function observationQuestionCount(
  _candidateCount: number,
  _axes: readonly MappedObservationAxis[],
): number {
  throw new Error('RED: observationQuestionCount is not implemented');
}

export function compareSharedAxisObservations(
  _fiveAxis: readonly AxisExperimentObservation[],
  _fourAxis: readonly AxisExperimentObservation[],
): readonly SharedAxisDelta[] {
  throw new Error('RED: compareSharedAxisObservations is not implemented');
}
