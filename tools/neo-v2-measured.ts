// neo-v2-measured.ts — V2 measured-local-inference subset driver.
//
// Consumes anvil.noul-observation.v2 records (parsed from the native Neo
// score log) and feeds them through the REAL V2 path:
//   noul-file-provider-v2 -> runObservationOnlyArmV2 (per trace)
//   -> ProviderShadowReplayCompilerV2 -> verified replay artifact.
//
// The result is descriptive measurement evidence ONLY:
//   evidence class measured-local-inference, ABI v2, subset 7/26,
//   promotion authority NONE. No promotion credential is minted.
//
//   npx tsx tools/neo-v2-measured.ts <campaignDir> <noulV2.jsonl> <inventory.json>

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createNoulFileProviderV2, loadNoulLogV2, neoLfmIdentityV2 } from '../src/lab/noul-file-provider-v2.js';
import { compileContextRetentionProgramV2, MODELED_SEMANTIC_AXES_V2, type ModeledSemanticAxisV2 } from '../src/lab/semantic-contract-v2.js';
import { ProviderShadowReplayCompilerV2, verifyProviderShadowReplayArtifactV2 } from '../src/lab/provider-shadow-replay-v2.js';
import { InMemoryCAS, encodeToolEvidence, sha256Digest } from '../src/lab/recovery.js';
import { SEMANTIC_AXIS_SPEC_DIGEST_V2 } from '../src/lab/semantic-axis-spec-v2.js';
import type { ReplayTrace } from '../src/lab/replay.js';
import type { SemanticCalibrationLabelV2 } from '../src/lab/semantic-label-v2.js';
import type { ObservationProfilesV2, ObservationPolicyThresholdsV2 } from '../src/lab/observation-arm-v2.js';

const [campaignDir, noulPath, inventoryPath] = process.argv.slice(2);
if (!campaignDir || !noulPath || !inventoryPath) {
  console.error('usage: neo-v2-measured.ts <campaignDir> <noulV2.jsonl> <inventory.json>');
  process.exit(2);
}
mkdirSync(campaignDir, { recursive: true });

const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
const identity = JSON.parse(readFileSync(`${campaignDir}/campaign-identity-v2.json`, 'utf8'));
const corpus = JSON.parse(readFileSync(`${campaignDir}/corpus-v2-subset.json`, 'utf8')) as ReplayTrace[];
const labels = JSON.parse(readFileSync(`${campaignDir}/labels-v2.json`, 'utf8')) as SemanticCalibrationLabelV2[];
const records = loadNoulLogV2(noulPath);
const samplesPath = `${campaignDir}/observer-samples-v2.json`;
const samples = JSON.parse(readFileSync(samplesPath, 'utf8')) as { samples?: number[] } | number[];

const neo = neoLfmIdentityV2({
  packageDigest: inventory.packageDigest,
  tokenizerDigest: inventory.tokenizerDigest,
  weightsDigest: inventory.weightsDigest,
  quantization: inventory.quantization,
  releaseId: inventory.releaseId,
  backend: inventory.backend,
  runtimeVersion: inventory.runtimeVersion,
  compilerDigest: inventory.compilerDigest,
  contextWindow: inventory.contextWindow,
  samplingDigest: inventory.samplingDigest,
  hardwareSemanticsClass: inventory.hardwareSemanticsClass,
});

// Fail-closed subset check: every selected candidate must have exactly one
// measured record and vice versa.
const manifestIds = new Set<string>(identity.subsetCandidates);
const recordIds = new Set(records.map((r) => r.candidateId));
for (const id of manifestIds) {
  if (!recordIds.has(id)) throw new Error(`measured record missing for ${id}`);
}
for (const id of recordIds) {
  if (!manifestIds.has(id)) throw new Error(`measured record for unselected candidate ${id}`);
}
for (const rec of records) {
  if (rec.providerProfileDigest !== neo.profile.providerProfileDigest) {
    throw new Error(`record ${rec.candidateId} binds stale provider profile ${rec.providerProfileDigest}`);
  }
  if (rec.axisSpecDigest !== SEMANTIC_AXIS_SPEC_DIGEST_V2) {
    throw new Error(`record ${rec.candidateId} binds stale axis spec ${rec.axisSpecDigest}`);
  }
}

const observationProfiles: ObservationProfilesV2 = {
  decision_contract: identity.decisionContract,
  execution_profile: {
    id: neo.profile.providerId,
    version: '2.0.0',
    digest: neo.profile.providerProfileDigest,
  },
  calibration_profile: identity.profiles.calibration_profile,
  policy_profile: identity.profiles.policy_profile,
};
const program = compileContextRetentionProgramV2(observationProfiles.decision_contract);
const thresholds: ObservationPolicyThresholdsV2 = {
  evidenceSufficientFloor: 0.8,
  retain: 0.5,
  keepFull: 0.8,
  reviewFloor: 0.8,
};

const cas = new InMemoryCAS();
for (const trace of corpus) {
  for (const c of trace.candidates) {
    cas.put(
      c.recovery.recovery_ref.slice(4),
      encodeToolEvidence(c.stdout, c.stderr, c.exit_status),
    );
  }
}

const provider = createNoulFileProviderV2(records, {
  expectedProfileDigest: neo.profile.providerProfileDigest,
});

const compiler = new ProviderShadowReplayCompilerV2();
const artifact = await compiler.compile({
  providerProfile: neo.profile,
  observationProfiles,
  compiledProgramDigest: program.programDigest,
  provider,
  traces: corpus,
  labels,
  cas,
  thresholds,
});
if (!verifyProviderShadowReplayArtifactV2(artifact)) {
  throw new Error('compiled V2 replay artifact failed self-verification');
}

// Descriptive (non-authoritative) metrics: per-axis accuracy at 0.5 and
// mean predicted probability vs mechanical target.
const byAxis = new Map<ModeledSemanticAxisV2, { n: number; correct: number; meanP: number; meanT: number }>();
const labelById = new Map(labels.map((l) => [l.labelId, l]));
for (const pred of artifact.predictions) {
  const label = labelById.get(pred.labelId);
  if (!label) continue;
  const bucket = byAxis.get(label.predicateId) ?? { n: 0, correct: 0, meanP: 0, meanT: 0 };
  bucket.n += 1;
  bucket.correct += (pred.probability >= 0.5 ? 1 : 0) === label.target ? 1 : 0;
  bucket.meanP += pred.probability;
  bucket.meanT += label.target;
  byAxis.set(label.predicateId, bucket);
}
const metrics = Object.fromEntries(
  MODELED_SEMANTIC_AXES_V2.map((axis) => {
    const b = byAxis.get(axis) ?? { n: 0, correct: 0, meanP: 0, meanT: 0 };
    return [axis, {
      n: b.n,
      accuracyAt05: b.n ? Number((b.correct / b.n).toFixed(4)) : null,
      meanProbability: b.n ? Number((b.meanP / b.n).toFixed(4)) : null,
      meanTarget: b.n ? Number((b.meanT / b.n).toFixed(4)) : null,
      brier: b.n ? Number((artifact.predictions
        .filter((p) => labelById.get(p.labelId)?.predicateId === axis)
        .reduce((a, p) => a + (p.probability - (labelById.get(p.labelId)?.target ?? 0)) ** 2, 0) / b.n).toFixed(6)) : null,
    }];
  }),
);

const wallTimes = Array.isArray(samples) ? samples : (samples.samples ?? []);
const report = {
  schema: 'anvil.measured-report.v2',
  evidenceClass: 'measured-local-inference',
  observationAbi: 'anvil.semantic-observation-abi.v2',
  retentionContract: 'anvil.context-retention.v2',
  subset: { scored: records.length, denominator: 26 },
  providerId: neo.profile.providerId,
  providerProfileDigest: neo.profile.providerProfileDigest,
  decisionContractDigest: observationProfiles.decision_contract.digest,
  compiledProgramDigest: program.programDigest,
  axisSpecDigest: SEMANTIC_AXIS_SPEC_DIGEST_V2,
  labelBindingDigest: identity.labelBindingDigest,
  replayDigest: artifact.replayDigest,
  predictions: artifact.predictions.length,
  receiptDigests: artifact.receiptDigests,
  wallTimeMs: {
    samples: wallTimes.length,
    values: wallTimes,
    note: 'per-candidate wall time on Neo under current machine conditions; honest measured latency',
  },
  metrics,
  nonAuthoritative: true,
  promotionAuthority: 'NONE',
  notes: [
    'Descriptive metrics only — a 7-candidate measured subset is not a production calibration campaign.',
    'No promotion credential minted; no routing authority granted.',
    'Records preserve conditional noul values plus absolute probe-token telemetry; telemetry is not semantic authority.',
  ],
};
const reportJson = JSON.stringify(report, null, 2) + '\n';
writeFileSync(`${campaignDir}/measured-report-v2.json`, reportJson);
console.log(`evidenceClass=measured-local-inference abi=v2 subset=${records.length}/26`);
console.log(`replayDigest=${artifact.replayDigest}`);
console.log(`providerProfileDigest=${neo.profile.providerProfileDigest}`);
console.log(`predictions=${artifact.predictions.length} receipts=${artifact.receiptDigests.length}`);
for (const axis of MODELED_SEMANTIC_AXES_V2) {
  console.log(`  ${axis}: ${JSON.stringify(metrics[axis])}`);
}
console.log('promotionAuthority=NONE');
