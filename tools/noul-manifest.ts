// Emits the noul probe manifest for the native Neo runner.
//
// For every campaign-corpus candidate we replay the real observation-arm
// request construction (carveHardRoots -> buildRequest) via a capture
// provider, then emit one JSONL row per (request, candidate) containing the
// canonical candidateViewDigest and the five per-axis probe prompts.
//
// The native runner scores each prompt and emits anvil.noul-observation.v1
// records echoing requestId/candidateId/candidateViewDigest — the TS side
// re-verifies the digest before accepting any probability.

import { mkdirSync, writeFileSync } from 'node:fs';
import { campaignCorpus, mintCampaignLabels } from '../src/lab/campaign-corpus.js';
import { candidateViewDigest } from '../src/lab/noul-file-provider.js';
import { runObservationOnlyArm } from '../src/lab/observation-arm.js';
import { InMemoryCAS, encodeToolEvidence, sha256Digest } from '../src/lab/recovery.js';
import {
  MAPPED_DECISION_RESPONSE_SCHEMA,
  MAPPED_OBSERVATION_AXES,
  type MappedDecisionRequest,
  type MappedObservationAxis,
} from '../src/lab/types.js';
import type { ObservationProfiles } from '../src/lab/observation-arm.js';

const outDir = process.argv[2] ?? 'artifacts/neo-campaign';
mkdirSync(outDir, { recursive: true });

export const AXIS_QUESTIONS: Record<MappedObservationAxis, string> = {
  evidence_sufficient:
    'Is the bounded evidence view shown above sufficient to judge whether this source should be retained?',
  still_needed:
    'Does this source carry information that is likely still needed for the mission?',
  full_content_needed:
    'Would replacing the omitted middle content with a short reference materially reduce the usefulness of this source?',
  unresolved_evidence:
    'Does this source contain unresolved failure, warning, contradiction, or verification evidence?',
  recoverable:
    'Can this candidate be semantically recovered through its declared identity and recovery reference?',
};

export function axisPrompt(
  request: MappedDecisionRequest,
  candidateId: string,
  axis: MappedObservationAxis,
): string {
  const view = request.candidate_views.find((c) => c.candidate_id === candidateId);
  if (!view) throw new Error(`unknown candidate ${candidateId}`);
  const sv = view.semantic_view;
  const hr = view.hard_roots;
  return [
    '<|im_start|>system',
    'You are a precise evidence classifier inside a deterministic audit pipeline.',
    'Answer the question about the tool-output evidence with exactly one word: Yes or No.',
    '<|im_end|>',
    '<|im_start|>user',
    `Mission: ${request.shared_conversation_state.mission}`,
    '',
    `Exit status: ${hr.exit_status}`,
    hr.stderr.length > 0 ? `Stderr: ${hr.stderr.join(' | ')}` : 'Stderr: (none)',
    '',
    '--- evidence head ---',
    sv.head,
    '--- evidence tail ---',
    sv.tail,
    `(${sv.omitted_bytes} bytes omitted between head and tail)`,
    '',
    `Question: ${AXIS_QUESTIONS[axis]}`,
    'Answer with exactly one word: Yes or No.',
    '<|im_end|>',
    '<|im_start|>assistant',
    '',
  ].join('\n');
}

const thresholds = { evidenceSufficientFloor: 0.0, keepFull: 2.0, retain: 2.0 };

function captureProvider(captured: MappedDecisionRequest[]) {
  return (request: MappedDecisionRequest) => {
    captured.push(request);
    return {
      schema: MAPPED_DECISION_RESPONSE_SCHEMA,
      request_id: request.request_id,
      observations: request.candidate_views.map((c) => ({
        candidate_id: c.candidate_id,
        evidence_sufficient: { noul: 0.5 },
        still_needed: { noul: 0.5 },
        full_content_needed: { noul: 0.5 },
        unresolved_evidence: { noul: 0.5 },
        recoverable: { noul: 0.5 },
      })),
    };
  };
}

async function main() {
  const corpus = campaignCorpus();
  const decisionContract = {
    id: 'anvil.context-retention.v1',
    version: '1.0.0',
    digest: sha256Digest(JSON.stringify({
      schema: 'anvil.decision-contract-identity.v1',
      id: 'anvil.context-retention.v1',
      version: '1.0.0',
      axes: MAPPED_OBSERVATION_AXES,
    })),
  };
  const corpusDigest = sha256Digest(JSON.stringify(corpus));
  const labelBindingDigest = sha256Digest(JSON.stringify({
    schema: 'anvil.label-binding.v1',
    corpusId: 'anvil.campaign-corpus.v1',
    corpusDigest,
    verifierIdentity: 'anvil.mechanical-source-verifier.v1',
    generation: 1,
  }));

  const profiles: ObservationProfiles = {
    decision_contract: decisionContract,
    execution_profile: { id: 'neo-lfm2.5-local', version: '1.0.0', digest: sha256Digest('exec') },
    calibration_profile: { id: 'shadow', version: '1.0.0', digest: sha256Digest('cal') },
    policy_profile: { id: 'shadow-policy', version: '1.0.0', digest: sha256Digest('pol') },
  };

  const captured: MappedDecisionRequest[] = [];
  const provider = captureProvider(captured);
  const rows: string[] = [];

  for (const trace of corpus) {
    const cas = new InMemoryCAS();
    for (const c of trace.candidates) {
      cas.put(c.recovery.recovery_ref.slice(4), encodeToolEvidence(c.stdout, c.stderr, c.exit_status));
    }
    const run = await runObservationOnlyArm(trace, cas, profiles, thresholds, provider);
    if (run.observations === null) {
      throw new Error(`trace ${trace.trace_id} fell back during manifest capture`);
    }
    const request = captured[captured.length - 1];
    for (const view of request.candidate_views) {
      const prompts = Object.fromEntries(
        MAPPED_OBSERVATION_AXES.map((axis) => [
          axis,
          axisPrompt(request, view.candidate_id, axis),
        ]),
      );
      rows.push(JSON.stringify({
        schema: 'anvil.noul-manifest.v1',
        requestId: request.request_id,
        traceId: trace.trace_id,
        candidateId: view.candidate_id,
        sourceDigest: view.source_digest,
        candidateViewDigest: candidateViewDigest(request, view.candidate_id),
        prompts,
      }));
    }
  }

  const labels = mintCampaignLabels({
    traces: corpus,
    decisionContractDigest: decisionContract.digest,
    labelBindingDigest,
  });

  writeFileSync(`${outDir}/noul-manifest.jsonl`, rows.join('\n') + '\n');
  writeFileSync(`${outDir}/corpus.json`, JSON.stringify(corpus, null, 2));
  writeFileSync(`${outDir}/labels.json`, JSON.stringify(labels, null, 2));
  writeFileSync(`${outDir}/campaign-identity.json`, JSON.stringify({
    decisionContract,
    corpusDigest,
    labelBindingDigest,
    profiles,
  }, null, 2));

  console.log(`manifest rows: ${rows.length}`);
  console.log(`labels: ${labels.length}`);
  console.log(`corpusDigest: ${corpusDigest}`);
  console.log(`decisionContractDigest: ${decisionContract.digest}`);
  console.log(`labelBindingDigest: ${labelBindingDigest}`);
}

await main();
