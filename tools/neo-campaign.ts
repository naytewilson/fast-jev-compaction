// neo-campaign.ts — Objective E+F driver.
//
//   tsx tools/neo-campaign.ts <campaignDir> <noul.jsonl> <inventory.json>
//
// campaignDir: output of tools/noul-manifest.ts (corpus.json, labels.json,
//   campaign-identity.json).
// noul.jsonl:  measured anvil.noul-observation.v1 rows (from the native
//   score run, via tools/parse-score-log.mjs) — or a fixture file when
//   NOUL_FIXTURE=1 (synthetic; the report says so).
// inventory:   measured machine/model identities (neo-inventory.json).
//
// Produces ProviderShadowReplayArtifact per split and a
// ProviderCalibrationBuildArtifact, writes their digests to
// campaign-report.json. Fail-closed: any structural violation aborts.

import { readFileSync, writeFileSync } from 'node:fs';
import { splitCampaignCorpus } from '../src/lab/campaign-corpus.js';
import {
  createNoulFileProvider,
  loadNoulLog,
  neoLfmIdentity,
} from '../src/lab/noul-file-provider.js';
import { ProviderShadowReplayCompiler } from '../src/lab/provider-shadow-replay.js';
import { CalibrationEvidenceCompiler } from '../src/lab/calibration-evidence-compiler.js';
import { compileContextRetentionProgram } from '../src/lab/semantic-program.js';
import { InMemoryCAS, encodeToolEvidence, sha256Digest } from '../src/lab/recovery.js';
import type { ReplayTrace } from '../src/lab/replay.js';
import type { SemanticCalibrationLabel } from '../src/lab/semantic-label.js';
import type { SemanticReplayPrediction } from '../src/lab/calibration-replay.js';
import type { ObservationProfiles } from '../src/lab/observation-arm.js';
import type { Digest256 } from '../src/lab/identity.js';
import type { ExecutionBackend } from '../src/lab/execution-profile.js';
import { verifyProviderExecutionProfile } from '../src/lab/provider-profile.js';
import { verifyProviderShadowReplayArtifact } from '../src/lab/provider-shadow-replay.js';
import { verifyProviderCalibrationBuildArtifact } from '../src/lab/calibration-evidence-compiler.js';
import { MAPPED_OBSERVATION_AXES } from '../src/lab/types.js';
import { mechanicalLabelTargets } from '../src/lab/campaign-corpus.js';

const [campaignDir, noulPath, inventoryPath] = process.argv.slice(2);
if (!campaignDir || !noulPath || !inventoryPath) {
  console.error('usage: tsx tools/neo-campaign.ts <campaignDir> <noul.jsonl> <inventory.json>');
  process.exit(2);
}

const corpus = JSON.parse(readFileSync(`${campaignDir}/corpus.json`, 'utf8')) as ReplayTrace[];
const labels = JSON.parse(readFileSync(`${campaignDir}/labels.json`, 'utf8')) as SemanticCalibrationLabel[];
const identity = JSON.parse(readFileSync(`${campaignDir}/campaign-identity.json`, 'utf8'));
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));

// --fixture-noul: synthesize records from mechanical targets + deterministic
// noise. The report marks evidenceClass accordingly — fixture rows are a
// pipeline harness check, never calibration evidence.
const fixtureMode = process.env.NOUL_FIXTURE === '1';

interface NoulRecordLoose {
  schema: string;
  candidateViewDigest: string;
  requestId: string;
  candidateId: string;
  axisProbabilities: Record<string, number>;
  probeMode: string;
  yesTokenIds: number[];
  noTokenIds: number[];
  promptDigests: Record<string, string>;
  timingsMs: { prefill: number; decode: number };
}

let records: NoulRecordLoose[];
if (fixtureMode) {
  const { candidateViewDigest } = await import('../src/lab/noul-file-provider.js');
  const { runObservationOnlyArm } = await import('../src/lab/observation-arm.js');
  const { MAPPED_DECISION_RESPONSE_SCHEMA } = await import('../src/lab/types.js');
  // Rebuild real requests so view digests bind exactly.
  const tmpProfiles: ObservationProfiles = {
    decision_contract: identity.decisionContract,
    execution_profile: { id: 'fx', version: '1', digest: sha256Digest('fx') },
    calibration_profile: { id: 'k', version: '1', digest: sha256Digest('k') },
    policy_profile: { id: 'p', version: '1', digest: sha256Digest('p') },
  };
  records = [];
  for (const trace of corpus) {
    let req: import('../src/lab/types.js').MappedDecisionRequest | undefined;
    const cas = new InMemoryCAS();
    for (const c of trace.candidates) {
      cas.put(c.recovery.recovery_ref.slice(4), encodeToolEvidence(c.stdout, c.stderr, c.exit_status));
    }
    await runObservationOnlyArm(trace, cas, tmpProfiles,
      { evidenceSufficientFloor: 0, keepFull: 2, retain: 2 },
      (request) => {
        req = request;
        return {
          schema: MAPPED_DECISION_RESPONSE_SCHEMA,
          request_id: request.request_id,
          observations: request.candidate_views.map((c) => ({
            candidate_id: c.candidate_id,
            evidence_sufficient: { noul: 0.5 }, still_needed: { noul: 0.5 },
            full_content_needed: { noul: 0.5 }, unresolved_evidence: { noul: 0.5 },
            recoverable: { noul: 0.5 },
          })),
        };
      });
    for (const cand of trace.candidates) {
      const targets = mechanicalLabelTargets(cand);
      const probs: Record<string, number> = {};
      const digests: Record<string, string> = {};
      MAPPED_OBSERVATION_AXES.forEach((axis, i) => {
        // fixture: target + small deterministic perturbation
        const base = targets[axis] === 1 ? 0.86 : 0.14;
        const wobble = ((trace.trace_id.charCodeAt(3) + i * 7) % 9) / 100;
        probs[axis] = Number(Math.min(0.97, Math.max(0.03, base + wobble - 0.04)).toFixed(6));
        digests[axis] = sha256Digest(`fixture:${trace.trace_id}:${axis}`);
      });
      records.push({
        schema: 'anvil.noul-observation.v1',
        candidateViewDigest: candidateViewDigest(req!, cand.candidate_id),
        requestId: req!.request_id,
        candidateId: cand.candidate_id,
        axisProbabilities: probs,
        probeMode: 'conditional',
        yesTokenIds: [11683, 12447, 18171, 17550],
        noTokenIds: [2243, 4547, 794, 2752],
        promptDigests: digests,
        timingsMs: { prefill: 0, decode: 0 },
      });
    }
  }
} else {
  records = [...loadNoulLog(noulPath)];
}
console.log(`records=${records.length} fixtureMode=${fixtureMode}`);

const neo = neoLfmIdentity({
  packageDigest: inventory.packageDigest,
  tokenizerDigest: inventory.tokenizerDigest,
  ...(inventory.weightsDigest ? { weightsDigest: inventory.weightsDigest } : {}),
  quantization: inventory.quantization,
  releaseId: inventory.releaseId,
  backend: inventory.backend as ExecutionBackend,
  runtimeVersion: inventory.runtimeVersion,
  compilerDigest: inventory.compilerDigest,
  contextWindow: inventory.contextWindow,
  samplingDigest: inventory.samplingDigest,
  ...(inventory.hardwareSemanticsClass
    ? { hardwareSemanticsClass: inventory.hardwareSemanticsClass }
    : {}),
});
if (!verifyProviderExecutionProfile(neo.profile)) {
  throw new Error('provider profile failed internal verification');
}
console.log(`providerProfileDigest=${neo.profile.providerProfileDigest}`);

const profiles: ObservationProfiles = {
  decision_contract: identity.decisionContract,
  execution_profile: {
    id: neo.profile.providerId,
    version: '1.0.0',
    digest: neo.profile.providerProfileDigest,
  },
  calibration_profile: { id: 'neo-shadow', version: '1.0.0', digest: sha256Digest('neo-shadow-cal') },
  policy_profile: { id: 'neo-shadow-policy', version: '1.0.0', digest: sha256Digest('neo-shadow-pol') },
};
const thresholds = { evidenceSufficientFloor: 0.8, keepFull: 0.8, retain: 0.5 };

const { training, holdout } = splitCampaignCorpus(corpus);
const sourceSet = (traces: ReplayTrace[]) =>
  new Set(traces.flatMap((t) => t.candidates.map((c) => c.recovery.source_digest)));
const trainSources = sourceSet(training);
const holdoutSources = sourceSet(holdout);
const trainingLabels = labels.filter((l) => trainSources.has(l.sourceDigest));
const holdoutLabels = labels.filter((l) => holdoutSources.has(l.sourceDigest));
console.log(`split: train=${training.length} traces/${trainingLabels.length} labels, holdout=${holdout.length}/${holdoutLabels.length}`);

function casFor(traces: ReplayTrace[]) {
  const cas = new InMemoryCAS();
  for (const t of traces) {
    for (const c of t.candidates) {
      cas.put(c.recovery.recovery_ref.slice(4), encodeToolEvidence(c.stdout, c.stderr, c.exit_status));
    }
  }
  return cas;
}

const provider = createNoulFileProvider(records as never);
const compiler = new ProviderShadowReplayCompiler();

async function replaySplit(traces: ReplayTrace[], splitLabels: SemanticCalibrationLabel[], name: string) {
  const artifact = await compiler.compile({
    providerProfile: neo.profile,
    observationProfiles: profiles,
    provider,
    traces,
    labels: splitLabels,
    cas: casFor(traces),
    thresholds,
  });
  console.log(`${name}: replayDigest=${artifact.replayDigest} predictions=${artifact.predictions.length} verified=${verifyProviderShadowReplayArtifact(artifact)}`);
  return artifact;
}

const trainArtifact = await replaySplit(training, trainingLabels, 'train');
const holdoutArtifact = await replaySplit(holdout, holdoutLabels, 'holdout');

const program = compileContextRetentionProgram(profiles.decision_contract);
const samplingPolicyDigest = sha256Digest(JSON.stringify({
  schema: 'anvil.sampling-policy.v1',
  rule: 'deterministic digest-parity split over campaign corpus v1',
}));
const labelAuthorityPolicyDigest = sha256Digest(JSON.stringify({
  schema: 'anvil.label-authority-policy.v1',
  rule: 'STRONG mechanical source-bound labels only; synthetic fixture scope declared',
}));

const build = new CalibrationEvidenceCompiler().compile({
  providerProfile: neo.profile,
  decisionContractDigest: profiles.decision_contract.digest as Digest256,
  compiledProgramDigest: program.programDigest as Digest256,
  samplingPolicyDigest: samplingPolicyDigest as Digest256,
  labelAuthorityPolicyDigest: labelAuthorityPolicyDigest as Digest256,
  labelBindingDigest: identity.labelBindingDigest as Digest256,
  trainingLabels,
  trainingPredictions: trainArtifact.predictions as readonly SemanticReplayPrediction[],
  holdoutLabels,
  holdoutPredictions: holdoutArtifact.predictions as readonly SemanticReplayPrediction[],
  confidenceFloor: 0.8,
  eceBins: 10,
});
console.log(`build: digest=${build.buildDigest} verified=${verifyProviderCalibrationBuildArtifact(build)}`);
console.log(`holdoutMetrics=${JSON.stringify(build.holdoutMetrics)}`);

const report = {
  schema: 'anvil.neo-campaign-report.v1',
  evidenceClass: fixtureMode ? 'synthetic-fixture' : 'measured-local-inference',
  providerProfileDigest: neo.profile.providerProfileDigest,
  modelIdentityDigest: neo.model.identityDigest,
  executionSemanticsDigest: neo.semantics.identityDigest,
  normalizerDigest: neo.normalizerDigest,
  observationABIDigest: neo.observationABIDigest,
  corpusDigest: identity.corpusDigest,
  decisionContractDigest: profiles.decision_contract.digest,
  labelBindingDigest: identity.labelBindingDigest,
  splits: { trainingTraces: training.length, holdoutTraces: holdout.length },
  trainReplayDigest: trainArtifact.replayDigest,
  holdoutReplayDigest: holdoutArtifact.replayDigest,
  calibrationBuildDigest: build.buildDigest,
  calibrationArtifactDigest: build.calibrationArtifact.artifactDigest,
  holdoutMetrics: build.holdoutMetrics,
};
writeFileSync(`${campaignDir}/campaign-report.json`, JSON.stringify(report, null, 2));
console.log('report -> campaign-report.json');
