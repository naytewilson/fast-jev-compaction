import type { Digest256 } from './identity.js';
import {
  runObservationOnlyArmV2,
  type ObservationPolicyThresholdsV2,
  type ObservationProfilesV2,
  type SemanticObservationProviderV2,
  type ObservationReplayRunV2,
} from './observation-arm-v2.js';
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
import type { ReplayTrace } from './replay.js';
import {
  selectAuthoritativeSemanticLabelsV2,
  type SemanticCalibrationLabelV2,
} from './semantic-label-v2.js';
import type { SemanticReplayPredictionV2 } from './calibration-replay-v2.js';
import { sha256Digest, type InMemoryCAS } from './recovery.js';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISSUE_TOKEN = Symbol('ANVIL.ProviderShadowReplayArtifact.v2');
const ISSUED = new WeakSet<object>();

export interface ProviderShadowReplayV2Input {
  providerProfile: ProviderExecutionProfile;
  observationProfiles: ObservationProfilesV2;
  compiledProgramDigest: Digest256;
  provider: SemanticObservationProviderV2;
  traces: readonly ReplayTrace[];
  labels: readonly SemanticCalibrationLabelV2[];
  cas: InMemoryCAS;
  thresholds: ObservationPolicyThresholdsV2;
}

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) {
    throw new TypeError(`${field} must be canonical sha256`);
  }
}

function freezePrediction(
  prediction: SemanticReplayPredictionV2,
): Readonly<SemanticReplayPredictionV2> {
  return Object.freeze({ ...prediction });
}

function replayDigest(input: {
  providerId: string;
  providerProfileDigest: Digest256;
  decisionContractDigest: Digest256;
  compiledProgramDigest: Digest256;
  labelBindingDigest: Digest256;
  labelsDigest: Digest256;
  receiptDigests: readonly Digest256[];
  predictions: readonly SemanticReplayPredictionV2[];
}): Digest256 {
  return sha256Digest(JSON.stringify({
    schema: 'anvil.provider-shadow-replay.v2',
    providerId: input.providerId,
    providerProfileDigest: input.providerProfileDigest,
    decisionContractDigest: input.decisionContractDigest,
    compiledProgramDigest: input.compiledProgramDigest,
    labelBindingDigest: input.labelBindingDigest,
    labelsDigest: input.labelsDigest,
    receiptDigests: input.receiptDigests,
    predictions: input.predictions,
  }));
}

export class ProviderShadowReplayArtifactV2 {
  public readonly schema = 'anvil.provider-shadow-replay.v2' as const;

  private constructor(
    token: symbol,
    public readonly providerId: string,
    public readonly providerProfileDigest: Digest256,
    public readonly decisionContractDigest: Digest256,
    public readonly compiledProgramDigest: Digest256,
    public readonly labelBindingDigest: Digest256,
    public readonly labelsDigest: Digest256,
    public readonly receiptDigests: readonly Digest256[],
    public readonly predictions: readonly Readonly<SemanticReplayPredictionV2>[],
    public readonly replayDigest: Digest256,
  ) {
    if (token !== ISSUE_TOKEN) {
      throw new Error('semantic v2 shadow replay constructor is compiler protected');
    }
    ISSUED.add(this);
    Object.freeze(this);
  }

  static issue(token: symbol, fields: {
    providerId: string;
    providerProfileDigest: Digest256;
    decisionContractDigest: Digest256;
    compiledProgramDigest: Digest256;
    labelBindingDigest: Digest256;
    labelsDigest: Digest256;
    receiptDigests: readonly Digest256[];
    predictions: readonly Readonly<SemanticReplayPredictionV2>[];
    replayDigest: Digest256;
  }): ProviderShadowReplayArtifactV2 {
    if (token !== ISSUE_TOKEN) {
      throw new Error('semantic v2 shadow replay issuer mismatch');
    }
    return new ProviderShadowReplayArtifactV2(
      token,
      fields.providerId,
      fields.providerProfileDigest,
      fields.decisionContractDigest,
      fields.compiledProgramDigest,
      fields.labelBindingDigest,
      fields.labelsDigest,
      fields.receiptDigests,
      fields.predictions,
      fields.replayDigest,
    );
  }
}

function validatePrediction(
  prediction: SemanticReplayPredictionV2,
  providerProfileDigest: string,
): void {
  if (!MODELED_SEMANTIC_AXES_V2.includes(prediction.predicateId)) {
    throw new TypeError(
      'semantic v2 replay prediction predicate is not one of the four modeled predicates',
    );
  }
  if (prediction.executionProfileDigest !== providerProfileDigest) {
    throw new Error('semantic v2 replay prediction provider profile mismatch');
  }
  for (const [field, value] of [
    ['sourceDigest', prediction.sourceDigest],
    ['executionProfileDigest', prediction.executionProfileDigest],
    ['observationDigest', prediction.observationDigest],
  ] as const) {
    requireDigest(value, field);
  }
  if (
    !Number.isFinite(prediction.probability) ||
    prediction.probability < 0 ||
    prediction.probability > 1
  ) {
    throw new TypeError('semantic v2 replay probability must be finite in [0,1]');
  }
}

function sourceIndex(
  traces: readonly ReplayTrace[],
): Map<string, { traceIndex: number; candidateId: string }> {
  const index = new Map<string, { traceIndex: number; candidateId: string }>();
  traces.forEach((trace, traceIndex) => {
    for (const candidate of trace.candidates) {
      requireDigest(candidate.recovery.source_digest, 'candidate source digest');
      if (index.has(candidate.recovery.source_digest)) {
        throw new Error(
          `ambiguous source evidence ${candidate.recovery.source_digest} appears in multiple candidates`,
        );
      }
      index.set(candidate.recovery.source_digest, {
        traceIndex,
        candidateId: candidate.candidate_id,
      });
    }
  });
  return index;
}

function observationProbability(
  observation: SemanticCandidateObservationV2,
  predicateId: SemanticCalibrationLabelV2['predicateId'],
): number {
  return observation[predicateId].noul;
}

export class ProviderShadowReplayCompilerV2 {
  async compile(
    input: ProviderShadowReplayV2Input,
  ): Promise<Readonly<ProviderShadowReplayArtifactV2>> {
    if (!verifyProviderExecutionProfile(input.providerProfile)) {
      throw new TypeError('semantic v2 provider profile is not internally verifiable');
    }
    if (
      input.providerProfile.observationABIDigest !==
      SEMANTIC_OBSERVATION_ABI_DIGEST_V2
    ) {
      throw new Error('semantic v2 provider profile Observation ABI mismatch');
    }
    if (
      input.observationProfiles.execution_profile.digest !==
      input.providerProfile.providerProfileDigest
    ) {
      throw new Error(
        'semantic v2 observation execution profile must equal provider profile digest',
      );
    }
    requireDigest(
      input.observationProfiles.decision_contract.digest,
      'decision contract digest',
    );
    requireDigest(input.compiledProgramDigest, 'compiledProgramDigest');

    const expectedProgram = compileContextRetentionProgramV2(
      input.observationProfiles.decision_contract,
    );
    if (input.compiledProgramDigest !== expectedProgram.programDigest) {
      throw new Error('semantic v2 compiled program digest mismatch');
    }

    if (input.labels.length === 0) {
      throw new TypeError('semantic v2 shadow replay requires calibration labels');
    }
    if (input.labels.some((label) => label.authority !== 'STRONG')) {
      throw new Error('semantic v2 shadow replay accepts STRONG labels only');
    }
    const authoritative = selectAuthoritativeSemanticLabelsV2(input.labels);
    if (authoritative.length !== input.labels.length) {
      throw new Error('semantic v2 shadow replay accepts STRONG labels only');
    }

    const binding = authoritative[0].labelBindingDigest;
    requireDigest(binding, 'labelBindingDigest');
    for (const label of authoritative) {
      if (
        label.decisionContractDigest !==
        input.observationProfiles.decision_contract.digest
      ) {
        throw new Error(
          'semantic v2 label decision contract does not match replay decision contract',
        );
      }
      if (label.labelBindingDigest !== binding) {
        throw new Error('semantic v2 shadow replay mixes label binding generations');
      }
    }
    const labelsDigest = sha256Digest(JSON.stringify({
      schema: 'anvil.provider-shadow-label-set.v2',
      labels: authoritative,
    }));

    const candidatesBySource = sourceIndex(input.traces);
    for (const label of authoritative) {
      if (!candidatesBySource.has(label.sourceDigest)) {
        throw new Error(
          `labeled source evidence is absent from semantic v2 replay traces: ${label.labelId}`,
        );
      }
    }

    const runs: ObservationReplayRunV2[] = [];
    for (const trace of input.traces) {
      const run = await runObservationOnlyArmV2(
        trace,
        input.cas,
        input.observationProfiles,
        input.thresholds,
        input.provider,
      );
      if (run.observations === null) {
        throw new Error(
          `semantic v2 provider shadow replay cannot materialize predictions for trace ${trace.trace_id}`,
        );
      }
      runs.push(run);
    }

    const observationsBySource = new Map<string, {
      candidateId: string;
      observation: SemanticCandidateObservationV2;
    }>();

    input.traces.forEach((trace, traceIndex) => {
      const run = runs[traceIndex];
      const byCandidate = new Map<string, SemanticCandidateObservationV2>(
        (run.observations ?? []).map(
          (observation): [string, SemanticCandidateObservationV2] => [
            observation.candidate_id,
            observation,
          ],
        ),
      );
      for (const candidate of trace.candidates) {
        const observation = byCandidate.get(candidate.candidate_id);
        if (observation === undefined) {
          throw new Error(
            `semantic v2 validated observation missing for candidate ${candidate.candidate_id}`,
          );
        }
        observationsBySource.set(candidate.recovery.source_digest, {
          candidateId: candidate.candidate_id,
          observation,
        });
      }
    });

    const predictions = Object.freeze(
      authoritative.map((label) => {
        const observed = observationsBySource.get(label.sourceDigest);
        if (observed === undefined) {
          throw new Error(
            `semantic v2 observation missing for labeled source ${label.labelId}`,
          );
        }
        const probability = observationProbability(
          observed.observation,
          label.predicateId,
        );
        const observationDigest = sha256Digest(JSON.stringify({
          schema: 'anvil.shadow-prediction-observation.v2',
          sourceDigest: label.sourceDigest,
          candidateId: observed.candidateId,
          predicateId: label.predicateId,
          observation: observed.observation[label.predicateId],
        }));
        return freezePrediction({
          labelId: label.labelId,
          predicateId: label.predicateId,
          sourceDigest: label.sourceDigest,
          executionProfileDigest: input.providerProfile.providerProfileDigest,
          observationDigest,
          probability,
        });
      }).sort((a, b) => a.labelId.localeCompare(b.labelId)),
    );

    const receiptDigests = Object.freeze(
      runs.flatMap((run) => run.receipts.map((receipt) => {
        requireDigest(receipt.receipt_digest, 'replay receipt digest');
        if (
          receipt.execution_profile_digest !==
          input.providerProfile.providerProfileDigest
        ) {
          throw new Error(
            'semantic v2 replay receipt execution profile drifted from provider profile',
          );
        }
        return receipt.receipt_digest;
      })),
    );

    const core = {
      providerId: input.providerProfile.providerId,
      providerProfileDigest: input.providerProfile.providerProfileDigest,
      decisionContractDigest:
        input.observationProfiles.decision_contract.digest,
      compiledProgramDigest: input.compiledProgramDigest,
      labelBindingDigest: binding,
      labelsDigest,
      receiptDigests,
      predictions,
    };
    const digest = replayDigest(core);
    return ProviderShadowReplayArtifactV2.issue(ISSUE_TOKEN, {
      ...core,
      replayDigest: digest,
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
    ) return false;
    const artifact = value as ProviderShadowReplayArtifactV2;
    if (artifact.schema !== 'anvil.provider-shadow-replay.v2') return false;
    if (artifact.providerId.length === 0 || artifact.providerId.includes('\0')) {
      return false;
    }
    for (const [field, value] of [
      ['providerProfileDigest', artifact.providerProfileDigest],
      ['decisionContractDigest', artifact.decisionContractDigest],
      ['compiledProgramDigest', artifact.compiledProgramDigest],
      ['labelBindingDigest', artifact.labelBindingDigest],
      ['labelsDigest', artifact.labelsDigest],
      ['replayDigest', artifact.replayDigest],
    ] as const) {
      requireDigest(value, field);
    }

    const ids = new Set<string>();
    for (const prediction of artifact.predictions) {
      validatePrediction(prediction, artifact.providerProfileDigest);
      if (ids.has(prediction.labelId)) return false;
      ids.add(prediction.labelId);
    }
    for (const digest of artifact.receiptDigests) {
      requireDigest(digest, 'receiptDigest');
    }

    return replayDigest({
      providerId: artifact.providerId,
      providerProfileDigest: artifact.providerProfileDigest,
      decisionContractDigest: artifact.decisionContractDigest,
      compiledProgramDigest: artifact.compiledProgramDigest,
      labelBindingDigest: artifact.labelBindingDigest,
      labelsDigest: artifact.labelsDigest,
      receiptDigests: artifact.receiptDigests,
      predictions: artifact.predictions,
    }) === artifact.replayDigest;
  } catch {
    return false;
  }
}
