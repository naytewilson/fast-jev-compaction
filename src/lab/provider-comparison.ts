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
import { sha256Digest, type InMemoryCAS } from './recovery.js';
import type { ReplayTrace } from './replay.js';

export interface ProviderComparisonArm {
  profile: ProviderExecutionProfile;
  observationProfiles: ObservationProfiles;
  provider: MappedObservationProvider;
}

export interface ProviderComparisonArmResult {
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
  observationSetDigest: Digest256;
  runs: readonly ObservationReplayRun[];
}

export interface ProviderComparisonResult {
  schema: 'anvil.provider-comparison.v1';
  traceCount: number;
  arms: readonly ProviderComparisonArmResult[];
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;

function validateArms(
  expectedObservationABIDigest: Digest256,
  arms: readonly ProviderComparisonArm[],
): void {
  if (!DIGEST.test(expectedObservationABIDigest)) {
    throw new TypeError('expected Observation ABI digest must be canonical sha256');
  }

  const providerIds = new Set<string>();
  const profileDigests = new Set<string>();
  for (const arm of arms) {
    if (!verifyProviderExecutionProfile(arm.profile)) {
      throw new TypeError('provider profile is not internally verifiable');
    }
    if (providerIds.has(arm.profile.providerId)) {
      throw new Error(`duplicate provider id ${arm.profile.providerId}`);
    }
    if (profileDigests.has(arm.profile.providerProfileDigest)) {
      throw new Error(`duplicate provider profile digest ${arm.profile.providerProfileDigest}`);
    }
    providerIds.add(arm.profile.providerId);
    profileDigests.add(arm.profile.providerProfileDigest);

    if (
      arm.observationProfiles.execution_profile.digest !==
      arm.profile.providerProfileDigest
    ) {
      throw new Error(
        'observation execution profile digest must equal full provider profile digest',
      );
    }
    if (arm.profile.observationABIDigest !== expectedObservationABIDigest) {
      throw new Error('provider profile does not target the campaign Observation ABI');
    }
  }
}

function aggregateTokens(
  runs: readonly ObservationReplayRun[],
  field: 'input_tokens' | 'output_tokens',
): number | null {
  const receipts = runs.flatMap((run) => run.receipts);
  if (receipts.length === 0) return 0;
  if (receipts.some((receipt) => receipt.provider_usage[field] === null)) return null;
  return receipts.reduce(
    (sum, receipt) => sum + (receipt.provider_usage[field] ?? 0),
    0,
  );
}

function aggregateArm(
  profile: ProviderExecutionProfile,
  runs: readonly ObservationReplayRun[],
): Readonly<ProviderComparisonArmResult> {
  const receipts = runs.flatMap((run) => run.receipts);
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

  const observationSetDigest = sha256Digest(JSON.stringify(
    receipts.map((receipt) => ({
      traceId: receipt.trace_id,
      observationSetDigest: receipt.observation_set_digest,
      receiptDigest: receipt.receipt_digest,
    })),
  ));

  return Object.freeze({
    providerId: profile.providerId,
    providerProfileDigest: profile.providerProfileDigest,
    executionProfileDigest: profile.providerProfileDigest,
    traceCount: runs.length,
    receiptCount: receipts.length,
    pristineFallbacks: receipts.filter((receipt) => receipt.pristine_fallback).length,
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
    providerFailures: receipts.filter((receipt) => receipt.error_code !== null).length,
    observationSetDigest,
    runs: Object.freeze([...runs]),
  });
}

export async function compareObservationProviders(
  traces: readonly ReplayTrace[],
  cas: InMemoryCAS,
  thresholds: ObservationPolicyThresholds,
  expectedObservationABIDigest: Digest256,
  arms: readonly ProviderComparisonArm[],
): Promise<Readonly<ProviderComparisonResult>> {
  validateArms(expectedObservationABIDigest, arms);

  const results: ProviderComparisonArmResult[] = [];
  for (const arm of arms) {
    const runs: ObservationReplayRun[] = [];
    for (const trace of traces) {
      runs.push(await runObservationOnlyArm(
        trace,
        cas,
        arm.observationProfiles,
        thresholds,
        arm.provider,
      ));
    }
    results.push(aggregateArm(arm.profile, runs));
  }

  return Object.freeze({
    schema: 'anvil.provider-comparison.v1' as const,
    traceCount: traces.length,
    arms: Object.freeze(results),
  });
}
