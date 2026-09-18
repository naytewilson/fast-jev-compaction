// neo-provider-comparison.ts — Objective L: available-provider comparison.
//
//   tsx tools/neo-provider-comparison.ts <campaignDir> <noul.jsonl|-> <inventory.json>
//
// Runs every ACTUALLY AVAILABLE provider arm over the campaign corpus:
//   1. neo-lfm2.5-local  — real profile; noul-file provider over measured
//      records when present, synthetic fixture records otherwise (labeled).
//   2. typesafe-system-one/jev-1.13.0 — offline synthetic envelope, labeled
//      synthetic-fixture (no JEV credential path exists locally).
// Mavis and Qwen-ANE are NOT run: no Mavis provider/model exists on this
// machine, and no verified Qwen ANE package was found. Absence is recorded,
// not fabricated.
//
// Writes provider-comparison.json. No cross-provider calibration transfer;
// no winner declared from synthetic-only evidence.

import { writeFileSync } from 'node:fs';
import { buildCampaignChain, makeCas } from './lib/campaign-chain.js';
import { compareObservationProviders, type ProviderComparisonArm } from '../src/lab/provider-comparison.js';
import { deriveProviderExecutionProfile } from '../src/lab/provider-profile.js';
import { sha256Digest } from '../src/lab/recovery.js';
import { MAPPED_DECISION_RESPONSE_SCHEMA } from '../src/lab/types.js';
import type { Digest256 } from '../src/lab/identity.js';

const [campaignDir, noulPath, inventoryPath] = process.argv.slice(2);
if (!campaignDir || !inventoryPath) {
  console.error('usage: tsx tools/neo-provider-comparison.ts <campaignDir> <noul.jsonl|-> <inventory.json>');
  process.exit(2);
}
const fixture = process.env.NOUL_FIXTURE === '1' || noulPath === '-';

const chain = await buildCampaignChain({
  campaignDir,
  noulPath: fixture ? undefined : noulPath,
  inventoryPath,
  fixture,
});
const abiDigest = chain.neo.profile.observationABIDigest;

// ---- Arm 1: Neo/LFM (real profile; records measured-or-fixture per input)
const neoArm: ProviderComparisonArm = {
  profile: chain.neo.profile,
  observationProfiles: chain.profiles,
  provider: chain.provider,
};

// ---- Arm 2: JEV synthetic fixture envelope (offline, labeled)
const jevProfile = deriveProviderExecutionProfile({
  providerId: 'typesafe-system-one/jev-1.13.0',
  providerKind: 'jev-system-one',
  modelIdentityDigest: sha256Digest('jev-1.13.0-fixture-model-identity') as Digest256,
  modelAssurance: 'opaqueVersioned',
  executionSemanticsDigest: sha256Digest('jev-fixture-execution-semantics') as Digest256,
  normalizerDigest: sha256Digest('jev-fixture-normalizer-v1') as Digest256,
  observationABIDigest: abiDigest,
});
const jevProvider = async (request: {
  request_id: string;
  candidate_views: readonly { candidate_id: string }[];
}) => ({
  mapped_response: {
    schema: MAPPED_DECISION_RESPONSE_SCHEMA,
    request_id: request.request_id,
    observations: request.candidate_views.map((c) => ({
      candidate_id: c.candidate_id,
      evidence_sufficient: { noul: 0.9 },
      still_needed: { noul: 0.8 },
      full_content_needed: { noul: 0.15 },
      unresolved_evidence: { noul: 0.2 },
      recoverable: { noul: 0.95 },
    })),
  },
  provider_metadata: {
    requested_model: 'jev-1.13.0-fixture',
    effective_model: 'jev-1.13.0-fixture',
    input_tokens: null,
    output_tokens: null,
    cost_usd: null,
  },
});
const jevArm: ProviderComparisonArm = {
  profile: jevProfile,
  observationProfiles: {
    ...chain.profiles,
    execution_profile: {
      id: jevProfile.providerId,
      version: '1.0.0',
      digest: jevProfile.providerProfileDigest,
    },
  },
  provider: jevProvider as never,
};

const result = await compareObservationProviders(
  chain.corpus,
  makeCas(chain.corpus),
  chain.thresholds,
  abiDigest,
  [neoArm, jevArm],
);

const report = {
  schema: 'anvil.neo-provider-comparison.v1',
  armsAvailable: [
    { providerId: neoArm.profile.providerId, evidenceClass: chain.evidenceClass },
    { providerId: jevProfile.providerId, evidenceClass: 'synthetic-fixture (offline envelope)' },
  ],
  armsUnavailable: [
    { providerKind: 'mavis', reason: 'no Mavis provider/model present on this machine' },
    { providerKind: 'qwen-ane', reason: 'no verified Qwen ANE package found locally' },
  ],
  traceCount: result.traceCount,
  arms: result.arms,
  note: 'No winner declared: neo arm is ' + chain.evidenceClass +
    ', jev arm is synthetic fixture. Cross-provider calibration transfer is forbidden.',
};
writeFileSync(`${campaignDir}/provider-comparison.json`, JSON.stringify(report, null, 2));
for (const arm of result.arms) {
  console.log(`${arm.providerId}: receipts=${arm.receiptCount} fallbacks=${arm.pristineFallbacks} abstain=${arm.abstentions} evict=${arm.evictions} full=${arm.fullPresentations} fails=${arm.providerFailures} latency=${arm.latencyMsTotal.toFixed(1)}ms`);
}
console.log('report -> provider-comparison.json');
