import type { Digest256 } from './identity.js';
import {
  runObservationOnlyArm,
  type MappedObservationProvider,
  type ObservationPolicyThresholds,
  type ObservationProfiles,
  type ObservationReplayRun,
} from './observation-arm.js';
import {
  verifyProviderExecutionProfile,
  type ProviderExecutionProfile,
} from './provider-profile.js';
import type { ReplayTrace } from './replay.js';
import {
  selectAuthoritativeSemanticLabels,
  type SemanticCalibrationLabel,
} from './semantic-label.js';
import type { SemanticReplayPrediction } from './calibration-replay.js';
import { sha256Digest, type InMemoryCAS } from './recovery.js';
import {
  MAPPED_OBSERVATION_AXES,
  type MappedCandidateObservation,
} from './types.js';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISSUE_TOKEN = Symbol('ANVIL.ProviderShadowReplayArtifact.v1');
const ISSUED = new WeakSet<object>();

export interface ProviderShadowReplayInput {
  providerProfile: ProviderExecutionProfile;
  observationProfiles: ObservationProfiles;
  provider: MappedObservationProvider;
  traces: readonly ReplayTrace[];
  labels: readonly SemanticCalibrationLabel[];
  cas: InMemoryCAS;
  thresholds: ObservationPolicyThresholds;
}

export interface ProviderShadowCampaignArm {
  providerProfile: ProviderExecutionProfile;
  observationProfiles: ObservationProfiles;
  provider: MappedObservationProvider;
}

export interface ProviderShadowCampaignInput {
  traces: readonly ReplayTrace[];
  labels: readonly SemanticCalibrationLabel[];
  cas: InMemoryCAS;
  thresholds: ObservationPolicyThresholds;
  arms: readonly ProviderShadowCampaignArm[];
}

export interface ProviderShadowCampaignFailure {
  providerId: string;
  providerProfileDigest: Digest256;
  code: 'shadow_replay_failed';
}

export interface ProviderShadowCampaignResult {
  schema: 'anvil.provider-shadow-campaign.v1';
  artifacts: readonly ProviderShadowReplayArtifact[];
  failures: readonly ProviderShadowCampaignFailure[];
}

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) {
    throw new TypeError(`${field} must be canonical sha256`);
  }
}

function freezePrediction(
  prediction: SemanticReplayPrediction,
): Readonly<SemanticReplayPrediction> {
  return Object.freeze({ ...prediction });
}

function validatePrediction(prediction: SemanticReplayPrediction): void {
  if (prediction.labelId.length === 0) {
    throw new TypeError('shadow prediction labelId must be non-empty');
  }
  if (!MAPPED_OBSERVATION_AXES.includes(prediction.predicateId)) {
    throw new TypeError('shadow prediction predicate is not registered');
  }
  requireDigest(prediction.sourceDigest, 'prediction sourceDigest');
  requireDigest(prediction.executionProfileDigest, 'prediction executionProfileDigest');
  requireDigest(prediction.observationDigest, 'prediction observationDigest');
  if (
    !Number.isFinite(prediction.probability) ||
    prediction.probability < 0 ||
    prediction.probability > 1
  ) {
    throw new TypeError('shadow prediction probability must be finite in [0,1]');
  }
}

function replayDigest(input: {
  providerId: string;
  providerProfileDigest: Digest256;
  decisionContractDigest: Digest256;
  labelBindingDigest: Digest256;
  labelsDigest: Digest256;
  receiptDigests: readonly Digest256[];
  predictions: readonly SemanticReplayPrediction[];
}): Digest256 {
  return sha256Digest(JSON.stringify({
    schema: 'anvil.provider-shadow-replay.v1',
    providerId: input.providerId,
    providerProfileDigest: input.providerProfileDigest,
    decisionContractDigest: input.decisionContractDigest,
    labelBindingDigest: input.labelBindingDigest,
    labelsDigest: input.labelsDigest,
    receiptDigests: input.receiptDigests,
    predictions: input.predictions,
  }));
}

export class ProviderShadowReplayArtifact {
  public readonly schema = 'anvil.provider-shadow-replay.v1' as const;

  private constructor(
    token: symbol,
    public readonly providerId: string,
    public readonly providerProfileDigest: Digest256,
    public readonly decisionContractDigest: Digest256,
    public readonly labelBindingDigest: Digest256,
    public readonly labelsDigest: Digest256,
    public readonly receiptDigests: readonly Digest256[],
    public readonly predictions: readonly Readonly<SemanticReplayPrediction>[],
    public readonly replayDigest: Digest256,
  ) {
    if (token !== ISSUE_TOKEN) {
      throw new Error('shadow replay artifact constructor is compiler protected');
    }
    ISSUED.add(this);
    Object.freeze(this);
  }

  static issue(token: symbol, fields: {
    providerId: string;
    providerProfileDigest: Digest256;
    decisionContractDigest: Digest256;
    labelBindingDigest: Digest256;
    labelsDigest: Digest256;
    receiptDigests: readonly Digest256[];
    predictions: readonly Readonly<SemanticReplayPrediction>[];
    replayDigest: Digest256;
  }): ProviderShadowReplayArtifact {
    if (token !== ISSUE_TOKEN) {
      throw new Error('shadow replay artifact issuer mismatch');
    }
    return new ProviderShadowReplayArtifact(
      token,
      fields.providerId,
      fields.providerProfileDigest,
      fields.decisionContractDigest,
      fields.labelBindingDigest,
      fields.labelsDigest,
      fields.receiptDigests,
      fields.predictions,
      fields.replayDigest,
    );
  }
}

function validateLabels(
  labels: readonly SemanticCalibrationLabel[],
  profiles: ObservationProfiles,
): {
  labels: readonly Readonly<SemanticCalibrationLabel>[];
  labelBindingDigest: Digest256;
  labelsDigest: Digest256;
} {
  if (labels.length === 0) {
    throw new TypeError('provider shadow replay requires calibration labels');
  }
  if (labels.some((label) => label.authority !== 'STRONG')) {
    throw new Error('provider shadow replay accepts STRONG labels only');
  }

  const authoritative = selectAuthoritativeSemanticLabels(labels);
  if (authoritative.length !== labels.length) {
    throw new Error('provider shadow replay accepts STRONG labels only');
  }

  const binding = authoritative[0].labelBindingDigest;
  requireDigest(binding, 'labelBindingDigest');
  for (const label of authoritative) {
    if (label.decisionContractDigest !== profiles.decision_contract.digest) {
      throw new Error('semantic label decision contract does not match replay decision contract');
    }
    if (label.labelBindingDigest !== binding) {
      throw new Error('provider shadow replay mixes label binding generations');
    }
  }

  const labelsDigest = sha256Digest(JSON.stringify({
    schema: 'anvil.provider-shadow-label-set.v1',
    labels: authoritative,
  }));

  return {
    labels: authoritative,
    labelBindingDigest: binding,
    labelsDigest,
  };
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

function predictionFromObservation(
  label: Readonly<SemanticCalibrationLabel>,
  candidateId: string,
  observation: MappedCandidateObservation,
  providerProfileDigest: Digest256,
): Readonly<SemanticReplayPrediction> {
  const probability = observation[label.predicateId].noul;
  const observationDigest = sha256Digest(JSON.stringify({
    schema: 'anvil.shadow-prediction-observation.v1',
    sourceDigest: label.sourceDigest,
    candidateId,
    predicateId: label.predicateId,
    observation: observation[label.predicateId],
  }));
  return freezePrediction({
    labelId: label.labelId,
    predicateId: label.predicateId,
    sourceDigest: label.sourceDigest,
    executionProfileDigest: providerProfileDigest,
    observationDigest,
    probability,
  });
}

export class ProviderShadowReplayCompiler {
  async compile(
    input: ProviderShadowReplayInput,
  ): Promise<Readonly<ProviderShadowReplayArtifact>> {
    if (!verifyProviderExecutionProfile(input.providerProfile)) {
      throw new TypeError('provider profile is not internally verifiable');
    }
    if (
      input.observationProfiles.execution_profile.digest !==
      input.providerProfile.providerProfileDigest
    ) {
      throw new Error('observation execution profile must equal provider profile digest');
    }
    requireDigest(
      input.observationProfiles.decision_contract.digest,
      'decision contract digest',
    );

    const validatedLabels = validateLabels(input.labels, input.observationProfiles);
    const candidatesBySource = sourceIndex(input.traces);

    for (const label of validatedLabels.labels) {
      if (!candidatesBySource.has(label.sourceDigest)) {
        throw new Error(`labeled source evidence is absent from replay traces: ${label.labelId}`);
      }
    }

    const runs: ObservationReplayRun[] = [];
    for (const trace of input.traces) {
      const run = await runObservationOnlyArm(
        trace,
        input.cas,
        input.observationProfiles,
        input.thresholds,
        input.provider,
      );
      if (run.observations === null) {
        throw new Error(
          `provider shadow replay cannot materialize authoritative predictions for trace ${trace.trace_id}`,
        );
      }
      runs.push(run);
    }

    const observationsBySource = new Map<string, {
      candidateId: string;
      observation: MappedCandidateObservation;
    }>();

    input.traces.forEach((trace, traceIndex) => {
      const run = runs[traceIndex];
      const byCandidate = new Map<string, MappedCandidateObservation>(
        (run.observations ?? []).map((observation): [string, MappedCandidateObservation] => [
          observation.candidate_id,
          observation,
        ]),
      );
      for (const candidate of trace.candidates) {
        const observation = byCandidate.get(candidate.candidate_id);
        if (observation === undefined) {
          throw new Error(
            `validated observation missing for candidate ${candidate.candidate_id}`,
          );
        }
        observationsBySource.set(candidate.recovery.source_digest, {
          candidateId: candidate.candidate_id,
          observation,
        });
      }
    });

    const predictions = Object.freeze(
      validatedLabels.labels.map((label) => {
        const observed = observationsBySource.get(label.sourceDigest);
        if (observed === undefined) {
          throw new Error(`observation missing for labeled source ${label.labelId}`);
        }
        return predictionFromObservation(
          label,
          observed.candidateId,
          observed.observation,
          input.providerProfile.providerProfileDigest,
        );
      }).sort((a, b) => a.labelId.localeCompare(b.labelId)),
    );

    const receiptDigests = Object.freeze(
      runs.flatMap((run) => run.receipts.map((receipt) => {
        requireDigest(receipt.receipt_digest, 'replay receipt digest');
        if (
          receipt.execution_profile_digest !==
          input.providerProfile.providerProfileDigest
        ) {
          throw new Error('replay receipt execution profile drifted from provider profile');
        }
        return receipt.receipt_digest;
      })),
    );

    const core = {
      providerId: input.providerProfile.providerId,
      providerProfileDigest: input.providerProfile.providerProfileDigest,
      decisionContractDigest: input.observationProfiles.decision_contract.digest,
      labelBindingDigest: validatedLabels.labelBindingDigest,
      labelsDigest: validatedLabels.labelsDigest,
      receiptDigests,
      predictions,
    };
    const digest = replayDigest(core);

    return ProviderShadowReplayArtifact.issue(ISSUE_TOKEN, {
      ...core,
      replayDigest: digest,
    });
  }
}

export function verifyProviderShadowReplayArtifact(
  value: unknown,
): value is ProviderShadowReplayArtifact {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      !(value instanceof ProviderShadowReplayArtifact) ||
      !ISSUED.has(value)
    ) return false;

    const artifact = value as ProviderShadowReplayArtifact;
    if (artifact.schema !== 'anvil.provider-shadow-replay.v1') return false;
    if (artifact.providerId.length === 0 || artifact.providerId.includes('\0')) return false;
    requireDigest(artifact.providerProfileDigest, 'providerProfileDigest');
    requireDigest(artifact.decisionContractDigest, 'decisionContractDigest');
    requireDigest(artifact.labelBindingDigest, 'labelBindingDigest');
    requireDigest(artifact.labelsDigest, 'labelsDigest');
    requireDigest(artifact.replayDigest, 'replayDigest');

    const labelIds = new Set<string>();
    for (const prediction of artifact.predictions) {
      validatePrediction(prediction);
      if (prediction.executionProfileDigest !== artifact.providerProfileDigest) {
        return false;
      }
      if (labelIds.has(prediction.labelId)) return false;
      labelIds.add(prediction.labelId);
    }
    for (const digest of artifact.receiptDigests) {
      requireDigest(digest, 'receiptDigest');
    }

    return replayDigest({
      providerId: artifact.providerId,
      providerProfileDigest: artifact.providerProfileDigest,
      decisionContractDigest: artifact.decisionContractDigest,
      labelBindingDigest: artifact.labelBindingDigest,
      labelsDigest: artifact.labelsDigest,
      receiptDigests: artifact.receiptDigests,
      predictions: artifact.predictions,
    }) === artifact.replayDigest;
  } catch {
    return false;
  }
}

export async function compileProviderShadowCampaign(
  input: ProviderShadowCampaignInput,
): Promise<Readonly<ProviderShadowCampaignResult>> {
  const providerIds = new Set<string>();
  const profileDigests = new Set<string>();
  for (const arm of input.arms) {
    if (!verifyProviderExecutionProfile(arm.providerProfile)) {
      throw new TypeError('campaign provider profile is not internally verifiable');
    }
    if (providerIds.has(arm.providerProfile.providerId)) {
      throw new Error(`duplicate provider id ${arm.providerProfile.providerId}`);
    }
    if (profileDigests.has(arm.providerProfile.providerProfileDigest)) {
      throw new Error(
        `duplicate provider profile digest ${arm.providerProfile.providerProfileDigest}`,
      );
    }
    providerIds.add(arm.providerProfile.providerId);
    profileDigests.add(arm.providerProfile.providerProfileDigest);
  }

  const artifacts: ProviderShadowReplayArtifact[] = [];
  const failures: ProviderShadowCampaignFailure[] = [];
  for (const arm of input.arms) {
    try {
      const artifact = await new ProviderShadowReplayCompiler().compile({
        providerProfile: arm.providerProfile,
        observationProfiles: arm.observationProfiles,
        provider: arm.provider,
        traces: input.traces,
        labels: input.labels,
        cas: input.cas,
        thresholds: input.thresholds,
      });
      artifacts.push(artifact);
    } catch {
      failures.push(Object.freeze({
        providerId: arm.providerProfile.providerId,
        providerProfileDigest: arm.providerProfile.providerProfileDigest,
        code: 'shadow_replay_failed' as const,
      }));
    }
  }

  return Object.freeze({
    schema: 'anvil.provider-shadow-campaign.v1' as const,
    artifacts: Object.freeze(artifacts),
    failures: Object.freeze(failures),
  });
}
