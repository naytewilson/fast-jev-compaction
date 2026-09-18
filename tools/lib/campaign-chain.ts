// Shared campaign chain bootstrap: corpus + labels + provider profile +
// per-split shadow replay artifacts + calibration build.
// Used by neo-campaign.ts and neo-fault-campaign.ts.

import { readFileSync } from 'node:fs';
import { splitCampaignCorpus } from '../../src/lab/campaign-corpus.js';
import {
  createNoulFileProvider,
  loadNoulLog,
  neoLfmIdentity,
  type NoulRecord,
  type NeoLfmIdentity,
} from '../../src/lab/noul-file-provider.js';
import {
  ProviderShadowReplayCompiler,
  type ProviderShadowReplayArtifact,
} from '../../src/lab/provider-shadow-replay.js';
import {
  CalibrationEvidenceCompiler,
  type ProviderCalibrationBuildArtifact,
} from '../../src/lab/calibration-evidence-compiler.js';
import { compileContextRetentionProgram } from '../../src/lab/semantic-program.js';
import { InMemoryCAS, encodeToolEvidence, sha256Digest } from '../../src/lab/recovery.js';
import type { ReplayTrace } from '../../src/lab/replay.js';
import type { SemanticCalibrationLabel } from '../../src/lab/semantic-label.js';
import type { ObservationProfiles, MappedObservationProvider } from '../../src/lab/observation-arm.js';
import type { Digest256 } from '../../src/lab/identity.js';
import type { ExecutionBackend } from '../../src/lab/execution-profile.js';
import { MAPPED_OBSERVATION_AXES, MAPPED_DECISION_RESPONSE_SCHEMA } from '../../src/lab/types.js';
import { mechanicalLabelTargets } from '../../src/lab/campaign-corpus.js';
import { runObservationOnlyArm } from '../../src/lab/observation-arm.js';
import { candidateViewDigest } from '../../src/lab/noul-file-provider.js';

export interface CampaignChain {
  corpus: ReplayTrace[];
  labels: SemanticCalibrationLabel[];
  // Measured-run coverage: when the noul log scores a strict subset of
  // candidates, the chain filters to scored candidates only (fail-closed
  // provider still rejects any missing view). measuredCandidates <
  // corpusCandidates marks a partial run — the report must say so.
  corpusCandidates: number;
  measuredCandidates: number;
  measuredCoverage: number;
  identity: {
    decisionContract: { id: string; version: string; digest: Digest256 };
    corpusDigest: Digest256;
    labelBindingDigest: Digest256;
  };
  neo: NeoLfmIdentity;
  profiles: ObservationProfiles;
  thresholds: { evidenceSufficientFloor: number; keepFull: number; retain: number };
  provider: MappedObservationProvider;
  training: ReplayTrace[];
  holdout: ReplayTrace[];
  trainingLabels: SemanticCalibrationLabel[];
  holdoutLabels: SemanticCalibrationLabel[];
  trainArtifact: Readonly<ProviderShadowReplayArtifact>;
  holdoutArtifact: Readonly<ProviderShadowReplayArtifact>;
  build: Readonly<ProviderCalibrationBuildArtifact>;
  samplingPolicyDigest: Digest256;
  labelAuthorityPolicyDigest: Digest256;
  programDigest: Digest256;
  evidenceClass: 'measured-local-inference' | 'synthetic-fixture';
  recordCount: number;
}

export function makeCas(traces: readonly ReplayTrace[]): InMemoryCAS {
  const cas = new InMemoryCAS();
  for (const t of traces) {
    for (const c of t.candidates) {
      cas.put(c.recovery.recovery_ref.slice(4), encodeToolEvidence(c.stdout, c.stderr, c.exit_status));
    }
  }
  return cas;
}

async function fixtureRecords(
  corpus: ReplayTrace[],
  decisionContract: { id: string; version: string; digest: Digest256 },
): Promise<NoulRecord[]> {
  const tmpProfiles: ObservationProfiles = {
    decision_contract: decisionContract,
    execution_profile: { id: 'fx', version: '1', digest: sha256Digest('fx') },
    calibration_profile: { id: 'k', version: '1', digest: sha256Digest('k') },
    policy_profile: { id: 'p', version: '1', digest: sha256Digest('p') },
  };
  const records: NoulRecord[] = [];
  for (const trace of corpus) {
    let req: import('../../src/lab/types.js').MappedDecisionRequest | undefined;
    await runObservationOnlyArm(trace, makeCas([trace]), tmpProfiles,
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
  return records;
}

export async function buildCampaignChain(input: {
  campaignDir: string;
  noulPath?: string;
  inventoryPath: string;
  fixture?: boolean;
}): Promise<CampaignChain> {
  const corpus = JSON.parse(readFileSync(`${input.campaignDir}/corpus.json`, 'utf8')) as ReplayTrace[];
  const labels = JSON.parse(readFileSync(`${input.campaignDir}/labels.json`, 'utf8')) as SemanticCalibrationLabel[];
  const identity = JSON.parse(readFileSync(`${input.campaignDir}/campaign-identity.json`, 'utf8'));
  const inventory = JSON.parse(readFileSync(input.inventoryPath, 'utf8'));

  const fixture = input.fixture === true;
  const records = fixture
    ? await fixtureRecords(corpus, identity.decisionContract)
    : [...loadNoulLog(input.noulPath!)];

  // Partial measured run: keep only candidates the noul log actually
  // scored (records carry per-axis probabilities for all 5 axes). The
  // provider remains fail-closed; this filter just decides which
  // candidates enter the chain at all.
  const corpusCandidates = corpus.flatMap((t) => t.candidates).length;
  let filteredCorpus = corpus;
  if (!fixture) {
    const scored = new Set(records.map((r) => r.candidateId));
    filteredCorpus = corpus
      .map((t) => ({
        ...t,
        candidates: t.candidates.filter((c) => scored.has(c.candidate_id)),
      }))
      .filter((t) => t.candidates.length > 0);
    const measured = filteredCorpus.flatMap((t) => t.candidates).length;
    if (measured === 0) throw new Error('noul log covers zero corpus candidates');
    if (measured < corpusCandidates) {
      console.error(`partial noul log: ${measured}/${corpusCandidates} candidates scored — chain uses the scored subset`);
    }
  }
  const measuredCandidates = filteredCorpus.flatMap((t) => t.candidates).length;
  const effectiveCorpus = filteredCorpus;
  const effectiveLabels = labels.filter((l) =>
    new Set(filteredCorpus.flatMap((t) =>
      t.candidates.map((c) => c.recovery.source_digest))).has(l.sourceDigest));

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

  const { training, holdout } = splitCampaignCorpus(effectiveCorpus);
  const src = (traces: ReplayTrace[]) =>
    new Set(traces.flatMap((t) => t.candidates.map((c) => c.recovery.source_digest)));
  const trainSources = src(training);
  const holdoutSources = src(holdout);
  const trainingLabels = effectiveLabels.filter((l) => trainSources.has(l.sourceDigest));
  const holdoutLabels = effectiveLabels.filter((l) => holdoutSources.has(l.sourceDigest));

  const provider = createNoulFileProvider(records);
  const compiler = new ProviderShadowReplayCompiler();
  const compileSplit = (traces: ReplayTrace[], splitLabels: SemanticCalibrationLabel[]) =>
    compiler.compile({
      providerProfile: neo.profile,
      observationProfiles: profiles,
      provider,
      traces,
      labels: splitLabels,
      cas: makeCas(traces),
      thresholds,
    });
  const trainArtifact = await compileSplit(training, trainingLabels);
  const holdoutArtifact = await compileSplit(holdout, holdoutLabels);

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
    decisionContractDigest: profiles.decision_contract.digest,
    compiledProgramDigest: program.programDigest,
    samplingPolicyDigest,
    labelAuthorityPolicyDigest,
    labelBindingDigest: identity.labelBindingDigest,
    trainingLabels,
    trainingPredictions: trainArtifact.predictions,
    holdoutLabels,
    holdoutPredictions: holdoutArtifact.predictions,
    confidenceFloor: 0.8,
    eceBins: 10,
  });

  return {
    corpus: effectiveCorpus, labels: effectiveLabels,
    corpusCandidates, measuredCandidates,
    measuredCoverage: corpusCandidates === 0 ? 0 : measuredCandidates / corpusCandidates,
    identity, neo, profiles, thresholds, provider,
    training, holdout, trainingLabels, holdoutLabels,
    trainArtifact, holdoutArtifact, build,
    samplingPolicyDigest, labelAuthorityPolicyDigest,
    programDigest: program.programDigest,
    evidenceClass: fixture ? 'synthetic-fixture' : 'measured-local-inference',
    recordCount: records.length,
  };
}
