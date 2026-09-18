import {
  verifyProviderCalibrationArtifact,
  type ProviderCalibrationArtifact,
} from './calibration-artifact.js';
import { applyIsotonicCalibration } from './isotonic-calibrator.js';
import {
  runObservationOnlyArm,
  type MappedObservationProvider,
  type ObservationPolicyThresholds,
  type ObservationProfiles,
} from './observation-arm.js';
import {
  fullPresentation,
  referentialPresentation,
  type ReplayPresentation,
  type ReplayTrace,
} from './replay.js';
import type { InMemoryCAS } from './recovery.js';
import {
  MAPPED_OBSERVATION_AXES,
  type MappedCandidateObservation,
} from './types.js';
import {
  verifyProviderExecutionProfile,
  type ProviderExecutionProfile,
} from './provider-profile.js';

export interface CalibratedObservationReplayInput {
  trace: ReplayTrace;
  cas: InMemoryCAS;
  profiles: ObservationProfiles;
  thresholds: ObservationPolicyThresholds;
  providerProfile: ProviderExecutionProfile;
  calibrationArtifact: ProviderCalibrationArtifact;
  provider: MappedObservationProvider;
}

export interface CalibratedObservationReplayResult {
  schema: 'anvil.calibrated-observation-replay.v1';
  status: 'CALIBRATED' | 'PRISTINE_FALLBACK';
  providerProfileDigest: string;
  calibrationIdentity: string;
  rawObservations: readonly MappedCandidateObservation[];
  calibratedObservations: readonly MappedCandidateObservation[];
  presentations: readonly ReplayPresentation[];
}

function freezeObservation(
  observation: MappedCandidateObservation,
): Readonly<MappedCandidateObservation> {
  return Object.freeze({
    candidate_id: observation.candidate_id,
    evidence_sufficient: Object.freeze({ ...observation.evidence_sufficient }),
    still_needed: Object.freeze({ ...observation.still_needed }),
    full_content_needed: Object.freeze({ ...observation.full_content_needed }),
    unresolved_evidence: Object.freeze({ ...observation.unresolved_evidence }),
  });
}

function validateBindings(input: CalibratedObservationReplayInput): void {
  if (!verifyProviderExecutionProfile(input.providerProfile)) {
    throw new TypeError('provider profile is not internally verifiable');
  }
  if (!verifyProviderCalibrationArtifact(input.calibrationArtifact)) {
    throw new TypeError('calibration artifact is not internally verifiable');
  }
  if (
    input.calibrationArtifact.providerProfileDigest !==
    input.providerProfile.providerProfileDigest
  ) {
    throw new Error('calibration artifact provider profile mismatch');
  }
  if (
    input.profiles.execution_profile.digest !==
    input.providerProfile.providerProfileDigest
  ) {
    throw new Error('execution profile does not match provider profile');
  }
  if (
    input.profiles.calibration_profile.digest !==
    input.calibrationArtifact.calibrationIdentity
  ) {
    throw new Error('calibration profile does not match calibration artifact identity');
  }
  if (
    input.profiles.decision_contract.digest !==
    input.calibrationArtifact.decisionContractDigest
  ) {
    throw new Error('decision contract does not match calibration artifact');
  }
}

function calibrateObservations(
  artifact: ProviderCalibrationArtifact,
  observations: readonly MappedCandidateObservation[],
): readonly MappedCandidateObservation[] {
  const calibrators = new Map(
    artifact.calibrators.map((model) => [model.predicateId, model]),
  );

  return Object.freeze(observations.map((observation) => {
    const calibrated: Record<string, { noul: number }> = {};
    for (const axis of MAPPED_OBSERVATION_AXES) {
      const model = calibrators.get(axis);
      if (model === undefined) {
        throw new Error(`missing calibrator for ${axis}`);
      }
      calibrated[axis] = Object.freeze({
        noul: applyIsotonicCalibration(model, observation[axis].noul),
      });
    }
    return freezeObservation({
      candidate_id: observation.candidate_id,
      evidence_sufficient: calibrated.evidence_sufficient,
      still_needed: calibrated.still_needed,
      full_content_needed: calibrated.full_content_needed,
      unresolved_evidence: calibrated.unresolved_evidence,
    });
  }));
}

function evaluateCalibratedPresentations(
  trace: ReplayTrace,
  cas: InMemoryCAS,
  observations: readonly MappedCandidateObservation[],
  thresholds: ObservationPolicyThresholds,
): readonly ReplayPresentation[] {
  const byID = new Map(
    observations.map((observation) => [observation.candidate_id, observation]),
  );

  return Object.freeze(trace.candidates.map((candidate) => {
    const observation = byID.get(candidate.candidate_id);
    if (observation === undefined) {
      return fullPresentation(candidate, 'PRISTINE_FALLBACK');
    }

    if (observation.evidence_sufficient.noul < thresholds.evidenceSufficientFloor) {
      return fullPresentation(candidate, 'ABSTAIN');
    }

    if (observation.unresolved_evidence.noul >= thresholds.keepFull) {
      return fullPresentation(candidate);
    }

    if (!cas.verifyTool(
      candidate.recovery,
      candidate.stdout,
      candidate.stderr,
      candidate.exit_status,
    ).ok) {
      return fullPresentation(candidate);
    }

    if (observation.full_content_needed.noul >= thresholds.keepFull) {
      return fullPresentation(candidate);
    }

    if (observation.still_needed.noul >= thresholds.retain) {
      return referentialPresentation(candidate);
    }

    return Object.freeze({
      candidate_id: candidate.candidate_id,
      disposition: 'EVICTED' as const,
      visible_text: '',
      source_digest: candidate.recovery.source_digest,
      omitted_bytes: candidate.recovery.byte_count,
      recovery_required: true,
    });
  }));
}

export async function runCalibratedObservationReplay(
  input: CalibratedObservationReplayInput,
): Promise<Readonly<CalibratedObservationReplayResult>> {
  validateBindings(input);

  const rawRun = await runObservationOnlyArm(
    input.trace,
    input.cas,
    input.profiles,
    input.thresholds,
    input.provider,
  );

  if (rawRun.observations === null) {
    return Object.freeze({
      schema: 'anvil.calibrated-observation-replay.v1' as const,
      status: 'PRISTINE_FALLBACK' as const,
      providerProfileDigest: input.providerProfile.providerProfileDigest,
      calibrationIdentity: input.calibrationArtifact.calibrationIdentity,
      rawObservations: Object.freeze([]),
      calibratedObservations: Object.freeze([]),
      presentations: Object.freeze([...rawRun.presentations]),
    });
  }

  const rawObservations = Object.freeze(
    rawRun.observations.map((observation) => freezeObservation(observation)),
  );
  const calibratedObservations = calibrateObservations(
    input.calibrationArtifact,
    rawObservations,
  );
  const presentations = evaluateCalibratedPresentations(
    input.trace,
    input.cas,
    calibratedObservations,
    input.thresholds,
  );

  return Object.freeze({
    schema: 'anvil.calibrated-observation-replay.v1' as const,
    status: 'CALIBRATED' as const,
    providerProfileDigest: input.providerProfile.providerProfileDigest,
    calibrationIdentity: input.calibrationArtifact.calibrationIdentity,
    rawObservations,
    calibratedObservations,
    presentations,
  });
}
