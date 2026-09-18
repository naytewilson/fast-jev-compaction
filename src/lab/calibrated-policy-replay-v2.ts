import {
  verifyProviderCalibrationArtifactV2,
  type ProviderCalibrationArtifactV2,
} from './provider-calibration-artifact-v2.js';
import { applyIsotonicCalibration } from './isotonic-calibrator.js';
import {
  createCalibratedPolicyReceiptV2,
  type CalibratedPolicyReceiptV2,
} from './calibrated-policy-receipt-v2.js';
import {
  runObservationOnlyArmV2,
  type ObservationProfilesV2,
  type SemanticObservationProviderV2,
} from './observation-arm-v2.js';
import type {
  ReplayPresentation,
  ReplayTrace,
} from './replay.js';
import { sha256Digest, type InMemoryCAS } from './recovery.js';
import type { ReplayReceipt } from './receipt.js';
import {
  decideSemanticPolicyV2,
  type SemanticPolicyDecisionV2,
} from './semantic-policy-v2.js';
import {
  compileContextRetentionProgramV2,
  MODELED_SEMANTIC_AXES_V2,
  SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
  type SemanticCandidateObservationV2,
} from './semantic-contract-v2.js';
import {
  verifyProviderExecutionProfile,
  type ProviderExecutionProfile,
} from './provider-profile.js';
import {
  verifySemanticPolicyProfileV2,
  type SemanticPolicyProfileV2,
} from './semantic-policy-profile-v2.js';
import type { MechanicalRecoveryEvidence } from './mechanical-recovery.js';

export interface CalibratedObservationReplayV2Input {
  trace: ReplayTrace;
  cas: InMemoryCAS;
  profiles: ObservationProfilesV2;
  policyProfile: SemanticPolicyProfileV2;
  providerProfile: ProviderExecutionProfile;
  calibrationArtifact: ProviderCalibrationArtifactV2;
  provider: SemanticObservationProviderV2;
}

export interface CalibratedObservationReplayV2Result {
  schema: 'anvil.calibrated-observation-replay.v2';
  status: 'CALIBRATED' | 'PRISTINE_FALLBACK';
  providerProfileDigest: string;
  calibrationIdentity: string;
  policyProfileDigest: string;
  rawObservations: readonly SemanticCandidateObservationV2[];
  calibratedObservations: readonly SemanticCandidateObservationV2[];
  mechanicalRecovery: readonly Readonly<MechanicalRecoveryEvidence>[];
  policyDecisions: readonly Readonly<SemanticPolicyDecisionV2>[];
  presentations: readonly ReplayPresentation[];
  rawReplayReceipt: ReplayReceipt;
  receipt: Readonly<CalibratedPolicyReceiptV2> | null;
}

function freezeObservation(
  observation: SemanticCandidateObservationV2,
): Readonly<SemanticCandidateObservationV2> {
  return Object.freeze({
    candidate_id: observation.candidate_id,
    evidence_sufficient: Object.freeze({
      ...observation.evidence_sufficient,
    }),
    still_needed: Object.freeze({
      ...observation.still_needed,
    }),
    full_content_needed: Object.freeze({
      ...observation.full_content_needed,
    }),
    unresolved_evidence: Object.freeze({
      ...observation.unresolved_evidence,
    }),
  });
}

function validateBindings(
  input: CalibratedObservationReplayV2Input,
): Readonly<ReturnType<typeof compileContextRetentionProgramV2>> {
  if (!verifyProviderExecutionProfile(input.providerProfile)) {
    throw new TypeError('semantic v2 provider profile is not internally verifiable');
  }
  if (
    input.providerProfile.observationABIDigest !==
    SEMANTIC_OBSERVATION_ABI_DIGEST_V2
  ) {
    throw new Error('semantic v2 provider profile Observation ABI mismatch');
  }
  if (!verifyProviderCalibrationArtifactV2(input.calibrationArtifact)) {
    throw new TypeError('semantic v2 calibration artifact is not internally verifiable');
  }
  if (
    input.calibrationArtifact.providerProfileDigest !==
    input.providerProfile.providerProfileDigest
  ) {
    throw new Error('semantic v2 calibration artifact provider profile mismatch');
  }
  if (
    input.profiles.execution_profile.digest !==
    input.providerProfile.providerProfileDigest
  ) {
    throw new Error('semantic v2 execution profile does not match provider profile');
  }
  if (
    input.profiles.calibration_profile.digest !==
    input.calibrationArtifact.calibrationIdentity
  ) {
    throw new Error('semantic v2 calibration profile does not match calibration artifact');
  }
  if (
    input.profiles.decision_contract.digest !==
    input.calibrationArtifact.decisionContractDigest
  ) {
    throw new Error('semantic v2 decision contract does not match calibration artifact');
  }

  const program = compileContextRetentionProgramV2(
    input.profiles.decision_contract,
  );
  if (
    input.calibrationArtifact.compiledProgramDigest !==
    program.programDigest
  ) {
    throw new Error('semantic v2 compiled program does not match calibration artifact');
  }

  if (!verifySemanticPolicyProfileV2(input.policyProfile)) {
    throw new TypeError('semantic v2 policy profile is not internally verifiable');
  }
  if (
    input.profiles.policy_profile.id !== input.policyProfile.id ||
    input.profiles.policy_profile.version !== input.policyProfile.version ||
    input.profiles.policy_profile.digest !==
    input.policyProfile.policyProfileDigest
  ) {
    throw new Error('semantic v2 policy profile identity mismatch');
  }

  return program;
}

function calibrateObservations(
  artifact: ProviderCalibrationArtifactV2,
  observations: readonly SemanticCandidateObservationV2[],
): readonly SemanticCandidateObservationV2[] {
  const calibrators = new Map(
    artifact.calibrators.map((model) => [model.predicateId, model]),
  );

  return Object.freeze(observations.map((observation) => {
    const calibrated: Record<string, { noul: number }> = {};
    for (const axis of MODELED_SEMANTIC_AXES_V2) {
      const model = calibrators.get(axis);
      if (model === undefined) {
        throw new Error('missing semantic v2 calibrator for ' + axis);
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
  observations: readonly SemanticCandidateObservationV2[],
  mechanicalRecovery: readonly MechanicalRecoveryEvidence[],
  policyProfile: SemanticPolicyProfileV2,
): {
  decisions: readonly Readonly<SemanticPolicyDecisionV2>[];
  presentations: readonly ReplayPresentation[];
} {
  const byID = new Map(
    observations.map((observation) => [
      observation.candidate_id,
      observation,
    ]),
  );
  const recoveryByID = new Map(
    mechanicalRecovery.map((evidence) => [
      evidence.candidate_id,
      evidence,
    ]),
  );

  const results = trace.candidates.map((candidate) => {
    const observation = byID.get(candidate.candidate_id);
    const recovery = recoveryByID.get(candidate.candidate_id);
    if (observation === undefined || recovery === undefined) {
      throw new Error(
        'semantic v2 calibrated policy evidence missing for ' +
        candidate.candidate_id,
      );
    }
    return decideSemanticPolicyV2({
      candidate,
      observation,
      thresholds: policyProfile.thresholds,
      recovery,
    });
  });

  return {
    decisions: Object.freeze(results.map((result) => result.decision)),
    presentations: Object.freeze(results.map((result) => result.presentation)),
  };
}

export async function runCalibratedObservationReplayV2(
  input: CalibratedObservationReplayV2Input,
): Promise<Readonly<CalibratedObservationReplayV2Result>> {
  const program = validateBindings(input);

  const rawRun = await runObservationOnlyArmV2(
    input.trace,
    input.cas,
    input.profiles,
    input.policyProfile.thresholds,
    input.provider,
  );

  const rawReplayReceipt = rawRun.receipts[0];
  if (rawReplayReceipt === undefined) {
    throw new Error('semantic v2 observation replay did not emit a receipt');
  }

  if (rawRun.observations === null) {
    return Object.freeze({
      schema: 'anvil.calibrated-observation-replay.v2' as const,
      status: 'PRISTINE_FALLBACK' as const,
      providerProfileDigest: input.providerProfile.providerProfileDigest,
      calibrationIdentity: input.calibrationArtifact.calibrationIdentity,
      policyProfileDigest: input.policyProfile.policyProfileDigest,
      rawObservations: Object.freeze([]),
      calibratedObservations: Object.freeze([]),
      mechanicalRecovery: rawRun.mechanicalRecovery,
      policyDecisions: Object.freeze([]),
      presentations: Object.freeze([...rawRun.presentations]),
      rawReplayReceipt,
      receipt: null,
    });
  }

  const rawObservations = Object.freeze(
    rawRun.observations.map((observation) =>
      freezeObservation(observation)),
  );
  const calibratedObservations = calibrateObservations(
    input.calibrationArtifact,
    rawObservations,
  );
  const evaluated = evaluateCalibratedPolicy(
    input.trace,
    calibratedObservations,
    rawRun.mechanicalRecovery,
    input.policyProfile,
  );

  const rawObservationDigest = sha256Digest(JSON.stringify({
    schema: 'anvil.semantic-observation-set.v2',
    observations: rawObservations,
  }));
  const calibratedObservationDigest = sha256Digest(JSON.stringify({
    schema: 'anvil.calibrated-semantic-observation-set.v2',
    observations: calibratedObservations,
  }));

  const receipt = createCalibratedPolicyReceiptV2({
    traceId: input.trace.trace_id,
    sourceRunId: input.trace.source_run_id,
    providerProfileDigest: input.providerProfile.providerProfileDigest,
    observationABIDigest: SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
    compiledProgramDigest: program.programDigest,
    calibrationIdentity: input.calibrationArtifact.calibrationIdentity,
    calibrationArtifactDigest: input.calibrationArtifact.artifactDigest,
    decisionContractDigest: input.profiles.decision_contract.digest,
    policyProfileDigest: input.policyProfile.policyProfileDigest,
    policySemanticsDigest: input.policyProfile.policySemanticsDigest,
    rawReplayReceiptDigest: rawReplayReceipt.receipt_digest,
    rawObservationDigest,
    calibratedObservationDigest,
    thresholds: input.policyProfile.thresholds,
    decisions: evaluated.decisions,
  });

  return Object.freeze({
    schema: 'anvil.calibrated-observation-replay.v2' as const,
    status: 'CALIBRATED' as const,
    providerProfileDigest: input.providerProfile.providerProfileDigest,
    calibrationIdentity: input.calibrationArtifact.calibrationIdentity,
    policyProfileDigest: input.policyProfile.policyProfileDigest,
    rawObservations,
    calibratedObservations,
    mechanicalRecovery: rawRun.mechanicalRecovery,
    policyDecisions: evaluated.decisions,
    presentations: evaluated.presentations,
    rawReplayReceipt,
    receipt,
  });
}
