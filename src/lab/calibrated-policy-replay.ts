import {
  verifyProviderCalibrationArtifact,
  type ProviderCalibrationArtifact,
} from './calibration-artifact.js';
import { applyIsotonicCalibration } from './isotonic-calibrator.js';
import {
  createCalibratedPolicyReceipt,
  type CalibratedPolicyReceipt,
} from './calibrated-policy-receipt.js';
import {
  runObservationOnlyArm,
  type MappedObservationProvider,
  type ObservationPolicyThresholds,
  type ObservationProfiles,
} from './observation-arm.js';
import type {
  ReplayPresentation,
  ReplayTrace,
} from './replay.js';
import { sha256Digest, type InMemoryCAS } from './recovery.js';
import type { ReplayReceipt } from './receipt.js';
import {
  decideSemanticPolicy,
  type SemanticPolicyDecision,
} from './semantic-policy.js';
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
  policyDecisions: readonly SemanticPolicyDecision[];
  presentations: readonly ReplayPresentation[];
  rawReplayReceipt: ReplayReceipt;
  receipt: Readonly<CalibratedPolicyReceipt> | null;
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

function evaluateCalibratedPolicy(
  trace: ReplayTrace,
  cas: InMemoryCAS,
  observations: readonly MappedCandidateObservation[],
  thresholds: ObservationPolicyThresholds,
): {
  decisions: readonly SemanticPolicyDecision[];
  presentations: readonly ReplayPresentation[];
} {
  const byID = new Map(
    observations.map((observation) => [observation.candidate_id, observation]),
  );

  const results = trace.candidates.map((candidate) => {
    const observation = byID.get(candidate.candidate_id);
    if (observation === undefined) {
      throw new Error(
        `calibrated observation missing candidate ${candidate.candidate_id}`,
      );
    }
    return decideSemanticPolicy({
      candidate,
      observation,
      thresholds,
      recovery: () => cas.verifyTool(
        candidate.recovery,
        candidate.stdout,
        candidate.stderr,
        candidate.exit_status,
      ),
    });
  });

  return {
    decisions: Object.freeze(results.map((result) => result.decision)),
    presentations: Object.freeze(results.map((result) => result.presentation)),
  };
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

  const rawReplayReceipt = rawRun.receipts[0];
  if (rawReplayReceipt === undefined) {
    throw new Error('observation replay did not emit a receipt');
  }

  if (rawRun.observations === null) {
    return Object.freeze({
      schema: 'anvil.calibrated-observation-replay.v1' as const,
      status: 'PRISTINE_FALLBACK' as const,
      providerProfileDigest: input.providerProfile.providerProfileDigest,
      calibrationIdentity: input.calibrationArtifact.calibrationIdentity,
      rawObservations: Object.freeze([]),
      calibratedObservations: Object.freeze([]),
      policyDecisions: Object.freeze([]),
      presentations: Object.freeze([...rawRun.presentations]),
      rawReplayReceipt,
      receipt: null,
    });
  }

  const rawObservations = Object.freeze(
    rawRun.observations.map((observation) => freezeObservation(observation)),
  );
  const calibratedObservations = calibrateObservations(
    input.calibrationArtifact,
    rawObservations,
  );
  const evaluated = evaluateCalibratedPolicy(
    input.trace,
    input.cas,
    calibratedObservations,
    input.thresholds,
  );
  const rawObservationDigest = sha256Digest(JSON.stringify(rawObservations));
  const calibratedObservationDigest =
    sha256Digest(JSON.stringify(calibratedObservations));
  const receipt = createCalibratedPolicyReceipt({
    traceId: input.trace.trace_id,
    sourceRunId: input.trace.source_run_id,
    providerProfileDigest: input.providerProfile.providerProfileDigest,
    calibrationIdentity: input.calibrationArtifact.calibrationIdentity,
    calibrationArtifactDigest: input.calibrationArtifact.artifactDigest,
    decisionContractDigest: input.profiles.decision_contract.digest,
    policyProfileDigest: input.profiles.policy_profile.digest,
    rawReplayReceiptDigest: rawReplayReceipt.receipt_digest,
    rawObservationDigest,
    calibratedObservationDigest,
    thresholds: input.thresholds,
    decisions: evaluated.decisions,
  });

  return Object.freeze({
    schema: 'anvil.calibrated-observation-replay.v1' as const,
    status: 'CALIBRATED' as const,
    providerProfileDigest: input.providerProfile.providerProfileDigest,
    calibrationIdentity: input.calibrationArtifact.calibrationIdentity,
    rawObservations,
    calibratedObservations,
    policyDecisions: evaluated.decisions,
    presentations: evaluated.presentations,
    rawReplayReceipt,
    receipt,
  });
}
