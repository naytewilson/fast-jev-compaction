import type { Digest256 } from './identity.js';
import type { SemanticReplayPrediction } from './calibration-replay.js';
import {
  SEMANTIC_SENSOR_ABI_V2_DIGEST,
  SEMANTIC_SENSOR_AXES_V2,
  validateSemanticSensorObservationV2,
  type SemanticSensorAxisV2,
  type SemanticSensorLaneIdentity,
  type SemanticSensorObservationV2,
} from './observation-abi-v2.js';
import {
  verifyProviderExecutionProfile,
  type ProviderExecutionProfile,
} from './provider-profile.js';
import { sha256Digest } from './recovery.js';
import {
  selectAuthoritativeSemanticLabels,
  type SemanticCalibrationLabel,
} from './semantic-label.js';

export interface ProviderShadowReplayV2Input {
  providerProfile: ProviderExecutionProfile;
  decisionContractDigest: Digest256;
  programDigest: Digest256;
  laneIdentities: readonly SemanticSensorLaneIdentity[];
  observations: readonly SemanticSensorObservationV2[];
  labels: readonly SemanticCalibrationLabel[];
  receiptDigests: readonly Digest256[];
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISSUE_TOKEN = Symbol('ANVIL.ProviderShadowReplayArtifact.v2');
const ISSUED = new WeakSet<object>();

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) {
    throw new TypeError(`${field} must be canonical sha256`);
  }
}

function predictionDigest(
  lane: SemanticSensorLaneIdentity,
  predicateId: SemanticSensorAxisV2,
  probability: number,
): Digest256 {
  return sha256Digest(JSON.stringify({
    schema: 'anvil.semantic-replay-observation.v2',
    observationABIDigest: SEMANTIC_SENSOR_ABI_V2_DIGEST,
    candidateId: lane.candidateId,
    originalOrdinal: lane.originalOrdinal,
    sourceDigest: lane.sourceDigest,
    programDigest: lane.programDigest,
    predicateId,
    probability,
  }));
}

function probabilityFor(
  observation: SemanticSensorObservationV2,
  predicateId: SemanticSensorAxisV2,
): number {
  switch (predicateId) {
    case 'evidence_sufficient':
      return observation.evidenceSufficient;
    case 'still_needed':
      return observation.predicates.stillNeeded;
    case 'full_content_needed':
      return observation.predicates.fullContentNeeded;
    case 'unresolved_evidence':
      return observation.predicates.unresolvedEvidence;
  }
}

function computeArtifactDigest(input: {
  providerProfileDigest: Digest256;
  decisionContractDigest: Digest256;
  programDigest: Digest256;
  labelBindingDigest: Digest256;
  labelsDigest: Digest256;
  receiptDigests: readonly Digest256[];
  predictions: readonly SemanticReplayPrediction[];
}): Digest256 {
  return sha256Digest(JSON.stringify({
    schema: 'anvil.provider-shadow-replay.v2',
    observationABIDigest: SEMANTIC_SENSOR_ABI_V2_DIGEST,
    ...input,
  }));
}

export class ProviderShadowReplayArtifactV2 {
  public readonly schema = 'anvil.provider-shadow-replay.v2' as const;

  private constructor(
    token: symbol,
    public readonly providerId: string,
    public readonly providerProfileDigest: Digest256,
    public readonly decisionContractDigest: Digest256,
    public readonly programDigest: Digest256,
    public readonly observationABIDigest: Digest256,
    public readonly labelBindingDigest: Digest256,
    public readonly labelsDigest: Digest256,
    public readonly receiptDigests: readonly Digest256[],
    public readonly predictions:
      readonly Readonly<SemanticReplayPrediction>[],
    public readonly replayDigest: Digest256,
  ) {
    if (token !== ISSUE_TOKEN) {
      throw new Error(
        'v2 shadow replay artifact constructor is compiler protected',
      );
    }
    ISSUED.add(this);
    Object.freeze(this);
  }

  static issue(
    token: symbol,
    fields: {
      providerId: string;
      providerProfileDigest: Digest256;
      decisionContractDigest: Digest256;
      programDigest: Digest256;
      labelBindingDigest: Digest256;
      labelsDigest: Digest256;
      receiptDigests: readonly Digest256[];
      predictions: readonly Readonly<SemanticReplayPrediction>[];
      replayDigest: Digest256;
    },
  ): ProviderShadowReplayArtifactV2 {
    if (token !== ISSUE_TOKEN) {
      throw new Error('v2 shadow replay artifact issuer mismatch');
    }
    return new ProviderShadowReplayArtifactV2(
      token,
      fields.providerId,
      fields.providerProfileDigest,
      fields.decisionContractDigest,
      fields.programDigest,
      SEMANTIC_SENSOR_ABI_V2_DIGEST,
      fields.labelBindingDigest,
      fields.labelsDigest,
      fields.receiptDigests,
      fields.predictions,
      fields.replayDigest,
    );
  }
}

export class ProviderShadowReplayV2Compiler {
  compile(
    input: ProviderShadowReplayV2Input,
  ): Readonly<ProviderShadowReplayArtifactV2> {
    if (!verifyProviderExecutionProfile(input.providerProfile)) {
      throw new TypeError('provider profile is not internally verifiable');
    }
    if (
      input.providerProfile.observationABIDigest !==
      SEMANTIC_SENSOR_ABI_V2_DIGEST
    ) {
      throw new Error(
        'provider profile Observation ABI does not match semantic sensor v2',
      );
    }

    requireDigest(input.decisionContractDigest, 'decisionContractDigest');
    requireDigest(input.programDigest, 'programDigest');
    if (input.laneIdentities.length === 0) {
      throw new TypeError('v2 shadow replay requires at least one lane');
    }
    if (input.observations.length !== input.laneIdentities.length) {
      throw new Error('v2 shadow replay observation cardinality mismatch');
    }
    if (input.receiptDigests.length === 0) {
      throw new TypeError('v2 shadow replay requires receipt provenance');
    }
    for (const digest of input.receiptDigests) {
      requireDigest(digest, 'receiptDigest');
    }

    const lanesByCandidate =
      new Map<string, SemanticSensorLaneIdentity>();
    const lanesBySource =
      new Map<string, SemanticSensorLaneIdentity>();
    for (const lane of input.laneIdentities) {
      requireDigest(lane.sourceDigest, 'lane sourceDigest');
      requireDigest(lane.programDigest, 'lane programDigest');
      if (lane.programDigest !== input.programDigest) {
        throw new Error('lane program identity does not match replay program');
      }
      if (
        lane.candidateId.length === 0 ||
        !Number.isSafeInteger(lane.originalOrdinal) ||
        lane.originalOrdinal < 0
      ) {
        throw new TypeError('v2 shadow replay lane identity is malformed');
      }
      if (lanesByCandidate.has(lane.candidateId)) {
        throw new Error(
          `duplicate v2 shadow replay candidate ${lane.candidateId}`,
        );
      }
      if (lanesBySource.has(lane.sourceDigest)) {
        throw new Error(
          `ambiguous source evidence ${lane.sourceDigest} appears in multiple lanes`,
        );
      }
      lanesByCandidate.set(lane.candidateId, lane);
      lanesBySource.set(lane.sourceDigest, lane);
    }

    const observationsBySource =
      new Map<string, SemanticSensorObservationV2>();
    for (const observation of input.observations) {
      const lane = lanesByCandidate.get(observation.candidateId);
      if (lane === undefined) {
        throw new Error(
          `v2 observation references unknown lane ${observation.candidateId}`,
        );
      }
      const validation =
        validateSemanticSensorObservationV2(lane, observation);
      if (!validation.ok) {
        throw new Error(
          `v2 observation lane identity invalid: ${validation.code}`,
        );
      }
      if (observationsBySource.has(observation.sourceDigest)) {
        throw new Error(
          `ambiguous v2 observation source ${observation.sourceDigest}`,
        );
      }
      observationsBySource.set(observation.sourceDigest, observation);
    }

    if (input.labels.length === 0) {
      throw new TypeError('v2 shadow replay requires calibration labels');
    }
    if (input.labels.some((label) => label.authority !== 'STRONG')) {
      throw new Error('v2 shadow replay accepts STRONG labels only');
    }
    const labels = selectAuthoritativeSemanticLabels(input.labels);
    if (labels.length !== input.labels.length) {
      throw new Error('v2 shadow replay accepts STRONG labels only');
    }

    const allowed = new Set<string>(SEMANTIC_SENSOR_AXES_V2);
    const binding = labels[0].labelBindingDigest;
    requireDigest(binding, 'labelBindingDigest');

    const labelKeys = new Set<string>();
    for (const label of labels) {
      if (!allowed.has(label.predicateId)) {
        throw new Error(
          `v2 predicate ${label.predicateId} is not modeled; recoverable is mechanical-only`,
        );
      }
      if (label.decisionContractDigest !== input.decisionContractDigest) {
        throw new Error(
          'semantic label decision contract does not match v2 replay contract',
        );
      }
      if (label.labelBindingDigest !== binding) {
        throw new Error(
          'v2 shadow replay mixes label binding generations',
        );
      }
      if (!lanesBySource.has(label.sourceDigest)) {
        throw new Error(
          `labeled source evidence is absent from v2 lanes: ${label.labelId}`,
        );
      }
      const key = `${label.sourceDigest}:${label.predicateId}`;
      if (labelKeys.has(key)) {
        throw new Error(
          `duplicate v2 label for source/predicate ${key}`,
        );
      }
      labelKeys.add(key);
    }

    const axisOrder = new Map(
      SEMANTIC_SENSOR_AXES_V2.map((axis, index) => [axis, index]),
    );
    const predictions = labels.map((label) => {
      const lane = lanesBySource.get(label.sourceDigest)!;
      const observation = observationsBySource.get(label.sourceDigest);
      if (observation === undefined) {
        throw new Error(
          `validated v2 observation missing for label ${label.labelId}`,
        );
      }
      const predicateId = label.predicateId as SemanticSensorAxisV2;
      const probability = probabilityFor(observation, predicateId);
      const prediction: SemanticReplayPrediction = {
        labelId: label.labelId,
        predicateId,
        sourceDigest: label.sourceDigest,
        executionProfileDigest:
          input.providerProfile.providerProfileDigest,
        observationDigest:
          predictionDigest(lane, predicateId, probability),
        probability,
      };
      return Object.freeze(prediction);
    });

    predictions.sort((a, b) => {
      const aLane = lanesBySource.get(a.sourceDigest)!;
      const bLane = lanesBySource.get(b.sourceDigest)!;
      return (
        aLane.originalOrdinal - bLane.originalOrdinal ||
        (axisOrder.get(a.predicateId as SemanticSensorAxisV2) ?? 99) -
          (axisOrder.get(b.predicateId as SemanticSensorAxisV2) ?? 99) ||
        a.labelId.localeCompare(b.labelId)
      );
    });

    const frozenPredictions = Object.freeze([...predictions]);
    const receiptDigests = Object.freeze([...input.receiptDigests]);
    const labelsDigest = sha256Digest(JSON.stringify({
      schema: 'anvil.provider-shadow-label-set.v2',
      observationABIDigest: SEMANTIC_SENSOR_ABI_V2_DIGEST,
      labels,
    }));
    const replayDigest = computeArtifactDigest({
      providerProfileDigest:
        input.providerProfile.providerProfileDigest,
      decisionContractDigest: input.decisionContractDigest,
      programDigest: input.programDigest,
      labelBindingDigest: binding,
      labelsDigest,
      receiptDigests,
      predictions: frozenPredictions,
    });

    return ProviderShadowReplayArtifactV2.issue(ISSUE_TOKEN, {
      providerId: input.providerProfile.providerId,
      providerProfileDigest:
        input.providerProfile.providerProfileDigest,
      decisionContractDigest: input.decisionContractDigest,
      programDigest: input.programDigest,
      labelBindingDigest: binding,
      labelsDigest,
      receiptDigests,
      predictions: frozenPredictions,
      replayDigest,
    });
  }
}

export function verifyProviderShadowReplayArtifactV2(
  value: unknown,
): value is ProviderShadowReplayArtifactV2 {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      !(value instanceof ProviderShadowReplayArtifactV2) ||
      !ISSUED.has(value)
    ) {
      return false;
    }

    const artifact = value as ProviderShadowReplayArtifactV2;
    if (artifact.schema !== 'anvil.provider-shadow-replay.v2') {
      return false;
    }
    if (
      artifact.observationABIDigest !==
      SEMANTIC_SENSOR_ABI_V2_DIGEST
    ) {
      return false;
    }
    for (const [field, digest] of [
      ['providerProfileDigest', artifact.providerProfileDigest],
      ['decisionContractDigest', artifact.decisionContractDigest],
      ['programDigest', artifact.programDigest],
      ['labelBindingDigest', artifact.labelBindingDigest],
      ['labelsDigest', artifact.labelsDigest],
      ['replayDigest', artifact.replayDigest],
    ] as const) {
      requireDigest(digest, field);
    }
    if (artifact.receiptDigests.length === 0) {
      return false;
    }
    for (const digest of artifact.receiptDigests) {
      requireDigest(digest, 'receiptDigest');
    }

    const allowed = new Set<string>(SEMANTIC_SENSOR_AXES_V2);
    const ids = new Set<string>();
    for (const prediction of artifact.predictions) {
      if (ids.has(prediction.labelId)) return false;
      ids.add(prediction.labelId);
      if (!allowed.has(prediction.predicateId)) return false;
      if (
        prediction.executionProfileDigest !==
        artifact.providerProfileDigest
      ) {
        return false;
      }
      requireDigest(prediction.sourceDigest, 'prediction sourceDigest');
      requireDigest(
        prediction.executionProfileDigest,
        'prediction executionProfileDigest',
      );
      requireDigest(
        prediction.observationDigest,
        'prediction observationDigest',
      );
      if (
        !Number.isFinite(prediction.probability) ||
        prediction.probability < 0 ||
        prediction.probability > 1
      ) {
        return false;
      }
    }

    return computeArtifactDigest({
      providerProfileDigest: artifact.providerProfileDigest,
      decisionContractDigest: artifact.decisionContractDigest,
      programDigest: artifact.programDigest,
      labelBindingDigest: artifact.labelBindingDigest,
      labelsDigest: artifact.labelsDigest,
      receiptDigests: artifact.receiptDigests,
      predictions: artifact.predictions,
    }) === artifact.replayDigest;
  } catch {
    return false;
  }
}
