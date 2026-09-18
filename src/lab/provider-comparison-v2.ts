import type { Digest256 } from './identity.js';
import {
  runObservationOnlyArmV2,
  type ObservationPolicyThresholdsV2,
  type ObservationProfilesV2,
  type ObservationReplayRunV2,
  type SemanticObservationProviderV2,
} from './observation-arm-v2.js';
import {
  MODELED_SEMANTIC_AXES_V2,
  SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
  type ModeledSemanticAxisV2,
} from './semantic-contract-v2.js';
import {
  verifyProviderExecutionProfile,
  type ProviderExecutionProfile,
} from './provider-profile.js';
import { sha256Digest, type InMemoryCAS } from './recovery.js';
import type { ReplayTrace } from './replay.js';

export interface ProviderComparisonArmV2 {
  profile: ProviderExecutionProfile;
  observationProfiles: ObservationProfilesV2;
  provider: SemanticObservationProviderV2;
}

export interface MechanicalRecoverySummaryV2 {
  verified: number;
  unavailable: number;
}

export type ModeledObservationMeansV2 = Readonly<
  Record<ModeledSemanticAxisV2, number | null>
>;

export interface ProviderComparisonArmResultV2 {
  providerId: string;
  providerProfileDigest: Digest256;
  executionProfileDigest: Digest256;
  traceCount: number;
  receiptCount: number;
  pristineFallbacks: number;
  abstentions: number;
  referentialPresentations: number;
  evictions: number;
  fullPresentations: number;
  latencyMsTotal: number;
  semanticInputTokens: number | null;
  semanticOutputTokens: number | null;
  providerFailures: number;
  modeledObservationCount: number;
  modeledObservationMeans: ModeledObservationMeansV2;
  mechanicalRecovery: Readonly<MechanicalRecoverySummaryV2>;
  observationSetDigest: Digest256;
  runs: readonly ObservationReplayRunV2[];
}

export interface ProviderComparisonResultV2 {
  schema: 'anvil.provider-comparison.v2';
  observationABIDigest: Digest256;
  traceCount: number;
  arms: readonly Readonly<ProviderComparisonArmResultV2>[];
  comparisonDigest: Digest256;
}

function validateArms(
  arms: readonly ProviderComparisonArmV2[],
): void {
  const providerIds = new Set<string>();
  const profileDigests = new Set<string>();

  for (const arm of arms) {
    if (!verifyProviderExecutionProfile(arm.profile)) {
      throw new TypeError(
        'semantic v2 provider comparison requires internally verifiable provider profiles',
      );
    }
    if (
      arm.profile.observationABIDigest !==
      SEMANTIC_OBSERVATION_ABI_DIGEST_V2
    ) {
      throw new Error(
        'semantic v2 provider profile does not target the canonical Observation ABI',
      );
    }
    if (
      arm.observationProfiles.execution_profile.digest !==
      arm.profile.providerProfileDigest
    ) {
      throw new Error(
        'semantic v2 comparison execution profile digest must equal full provider profile digest',
      );
    }
    if (providerIds.has(arm.profile.providerId)) {
      throw new Error(
        `duplicate provider id ${arm.profile.providerId}`,
      );
    }
    if (profileDigests.has(arm.profile.providerProfileDigest)) {
      throw new Error(
        `duplicate provider profile digest ${arm.profile.providerProfileDigest}`,
      );
    }
    providerIds.add(arm.profile.providerId);
    profileDigests.add(arm.profile.providerProfileDigest);
  }
}

function aggregateTokens(
  runs: readonly ObservationReplayRunV2[],
  field: 'input_tokens' | 'output_tokens',
): number | null {
  const receipts = runs.flatMap((run) => run.receipts);
  if (receipts.length === 0) return 0;
  if (
    receipts.some(
      (receipt) => receipt.provider_usage[field] === null,
    )
  ) {
    return null;
  }
  return receipts.reduce(
    (sum, receipt) => sum + (receipt.provider_usage[field] ?? 0),
    0,
  );
}

function modeledMeans(
  runs: readonly ObservationReplayRunV2[],
): {
  count: number;
  means: ModeledObservationMeansV2;
} {
  const observations = runs.flatMap(
    (run) => run.observations === null ? [] : [...run.observations],
  );

  const sums: Record<ModeledSemanticAxisV2, number> = {
    evidence_sufficient: 0,
    still_needed: 0,
    full_content_needed: 0,
    unresolved_evidence: 0,
  };

  for (const observation of observations) {
    for (const axis of MODELED_SEMANTIC_AXES_V2) {
      sums[axis] += observation[axis].noul;
    }
  }

  const count = observations.length;
  const means = Object.freeze(
    Object.fromEntries(
      MODELED_SEMANTIC_AXES_V2.map((axis) => [
        axis,
        count === 0 ? null : sums[axis] / count,
      ]),
    ) as Record<ModeledSemanticAxisV2, number | null>,
  );

  return { count, means };
}

function mechanicalRecoverySummary(
  runs: readonly ObservationReplayRunV2[],
): Readonly<MechanicalRecoverySummaryV2> {
  let verified = 0;
  let unavailable = 0;
  for (const evidence of runs.flatMap(
    (run) => [...run.mechanicalRecovery],
  )) {
    if (evidence.status === 'VERIFIED') verified += 1;
    else unavailable += 1;
  }
  return Object.freeze({ verified, unavailable });
}

function aggregateArm(
  profile: ProviderExecutionProfile,
  runs: readonly ObservationReplayRunV2[],
): Readonly<ProviderComparisonArmResultV2> {
  const receipts = runs.flatMap((run) => run.receipts);
  const observationStats = modeledMeans(runs);

  let abstentions = 0;
  let referentialPresentations = 0;
  let evictions = 0;
  let fullPresentations = 0;

  for (const run of runs) {
    for (const presentation of run.presentations) {
      switch (presentation.disposition) {
        case 'ABSTAIN':
          abstentions += 1;
          break;
        case 'REFERENTIAL':
          referentialPresentations += 1;
          break;
        case 'EVICTED':
          evictions += 1;
          break;
        case 'FULL':
        case 'PRISTINE_FALLBACK':
          fullPresentations += 1;
          break;
      }
    }
  }

  const observationSetDigest = sha256Digest(JSON.stringify({
    schema: 'anvil.provider-comparison-observation-set.v2',
    providerProfileDigest: profile.providerProfileDigest,
    receipts: receipts.map((receipt) => ({
      traceId: receipt.trace_id,
      observationSetDigest: receipt.observation_set_digest,
      receiptDigest: receipt.receipt_digest,
    })),
    modeledObservationMeans: observationStats.means,
    mechanicalRecovery: mechanicalRecoverySummary(runs),
  }));

  return Object.freeze({
    providerId: profile.providerId,
    providerProfileDigest: profile.providerProfileDigest,
    executionProfileDigest: profile.providerProfileDigest,
    traceCount: runs.length,
    receiptCount: receipts.length,
    pristineFallbacks: receipts.filter(
      (receipt) => receipt.pristine_fallback,
    ).length,
    abstentions,
    referentialPresentations,
    evictions,
    fullPresentations,
    latencyMsTotal: receipts.reduce(
      (sum, receipt) => sum + (receipt.latency_ms ?? 0),
      0,
    ),
    semanticInputTokens: aggregateTokens(runs, 'input_tokens'),
    semanticOutputTokens: aggregateTokens(runs, 'output_tokens'),
    providerFailures: receipts.filter(
      (receipt) => receipt.error_code !== null,
    ).length,
    modeledObservationCount: observationStats.count,
    modeledObservationMeans: observationStats.means,
    mechanicalRecovery: mechanicalRecoverySummary(runs),
    observationSetDigest,
    runs: Object.freeze([...runs]),
  });
}

export async function compareObservationProvidersV2(
  traces: readonly ReplayTrace[],
  cas: InMemoryCAS,
  thresholds: ObservationPolicyThresholdsV2,
  arms: readonly ProviderComparisonArmV2[],
): Promise<Readonly<ProviderComparisonResultV2>> {
  validateArms(arms);

  const results: Readonly<ProviderComparisonArmResultV2>[] = [];
  for (const arm of arms) {
    const runs: ObservationReplayRunV2[] = [];
    for (const trace of traces) {
      runs.push(await runObservationOnlyArmV2(
        trace,
        cas,
        arm.observationProfiles,
        thresholds,
        arm.provider,
      ));
    }
    results.push(aggregateArm(arm.profile, runs));
  }

  const core = {
    schema: 'anvil.provider-comparison.v2' as const,
    observationABIDigest: SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
    traceCount: traces.length,
    arms: Object.freeze(results),
  };

  return Object.freeze({
    ...core,
    comparisonDigest: sha256Digest(JSON.stringify({
      schema: core.schema,
      observationABIDigest: core.observationABIDigest,
      traceCount: core.traceCount,
      arms: core.arms.map((arm) => ({
        providerId: arm.providerId,
        providerProfileDigest: arm.providerProfileDigest,
        observationSetDigest: arm.observationSetDigest,
      })),
    })),
  });
}
