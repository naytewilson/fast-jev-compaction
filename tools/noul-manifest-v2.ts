// Emits the V2 noul probe manifest for the native Neo scorer.
//
// For every selected campaign-corpus candidate we replay the REAL V2
// observation-arm request construction (carveHardRoots -> buildRequest via
// runObservationOnlyArmV2) with a capture provider, then emit one JSONL row
// per (request, candidate) carrying the V2 candidate-view identity and the
// four per-axis probe prompts derived from the shared V2 axis spec.
//
// Subset mode: the measurement corpus is restricted to candidate IDs that
// already have V1 measured evidence (the same seven candidates get a
// genuine V2 rescore — V1 probabilities are never projected forward).
//
//   npx tsx tools/noul-manifest-v2.ts [outDir] [candidateId,candidateId,...]

import { mkdirSync, writeFileSync } from 'node:fs';
import { campaignCorpus } from '../src/lab/campaign-corpus.js';
import { mintCampaignLabelsV2 } from '../src/lab/campaign-corpus-v2.js';
import { candidateViewDigestV2 } from '../src/lab/noul-file-provider-v2.js';
import { runObservationOnlyArmV2 } from '../src/lab/observation-arm-v2.js';
import { InMemoryCAS, encodeToolEvidence, sha256Digest } from '../src/lab/recovery.js';
import {
  MODELED_SEMANTIC_AXES_V2,
  SEMANTIC_DECISION_RESPONSE_SCHEMA_V2,
  type ModeledSemanticAxisV2,
  type SemanticDecisionRequestV2,
} from '../src/lab/semantic-contract-v2.js';
import {
  SEMANTIC_AXIS_PROBE_QUESTIONS_V2,
  SEMANTIC_AXIS_SPEC_DIGEST_V2,
} from '../src/lab/semantic-axis-spec-v2.js';
import type { ObservationProfilesV2 } from '../src/lab/observation-arm-v2.js';

const outDir = process.argv[2] ?? 'artifacts/neo-campaign-v2';
const subsetArg = process.argv[3];
const DEFAULT_SUBSET = [
  'cand-ct-00-0001', 'cand-ct-01-0001', 'cand-ct-02-0001', 'cand-ct-03-0001',
  'cand-ct-04-0001', 'cand-ct-05-0001', 'cand-ct-06-0001',
];
const subset = new Set(subsetArg ? subsetArg.split(',') : DEFAULT_SUBSET);
mkdirSync(outDir, { recursive: true });

export function axisPromptV2(
  request: SemanticDecisionRequestV2,
  candidateId: string,
  axis: ModeledSemanticAxisV2,
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
    `Question: ${SEMANTIC_AXIS_PROBE_QUESTIONS_V2[axis]}`,
    'Answer with exactly one word: Yes or No.',
    '<|im_end|>',
    '<|im_start|>assistant',
    '',
  ].join('\n');
}

const thresholds = {
  evidenceSufficientFloor: 0.0,
  retain: 0.5,
  keepFull: 0.9,
  reviewFloor: 0.8,
};

function captureProvider(captured: SemanticDecisionRequestV2[]) {
  return (request: SemanticDecisionRequestV2) => {
    captured.push(request);
    return {
      schema: SEMANTIC_DECISION_RESPONSE_SCHEMA_V2,
      request_id: request.request_id,
      observations: request.candidate_views.map((c) => ({
        candidate_id: c.candidate_id,
        evidence_sufficient: { noul: 0.5 },
        still_needed: { noul: 0.5 },
        full_content_needed: { noul: 0.5 },
        unresolved_evidence: { noul: 0.5 },
      })),
    };
  };
}

async function main() {
  const corpus = campaignCorpus().filter((trace) =>
    trace.candidates.some((c) => subset.has(c.candidate_id)));
  const covered = new Set(
    corpus.flatMap((t) => t.candidates.map((c) => c.candidate_id)),
  );
  for (const id of subset) {
    if (!covered.has(id)) throw new Error(`subset candidate ${id} not in corpus`);
  }

  const decisionContract = {
    id: 'anvil.context-retention.v2',
    version: '2.0.0',
    digest: sha256Digest(JSON.stringify({
      schema: 'anvil.decision-contract-identity.v2',
      id: 'anvil.context-retention.v2',
      version: '2.0.0',
      axes: MODELED_SEMANTIC_AXES_V2,
    })),
  };
  const corpusDigest = sha256Digest(JSON.stringify(corpus));
  const labelBindingDigest = sha256Digest(JSON.stringify({
    schema: 'anvil.label-binding.v2',
    corpusId: 'anvil.campaign-corpus.v2',
    corpusDigest,
    verifierIdentity: 'anvil.mechanical-source-verifier.v2',
    generation: 1,
    subset: [...subset].sort(),
  }));

  const profiles: ObservationProfilesV2 = {
    decision_contract: decisionContract,
    execution_profile: { id: 'neo-lfm2.5-local-v2', version: '2.0.0', digest: sha256Digest('exec-v2-subset') },
    calibration_profile: { id: 'shadow-v2', version: '2.0.0', digest: sha256Digest('cal-v2') },
    policy_profile: { id: 'shadow-policy-v2', version: '2.0.0', digest: sha256Digest('pol-v2') },
  };

  const captured: SemanticDecisionRequestV2[] = [];
  const provider = captureProvider(captured);
  const rows: string[] = [];

  for (const trace of corpus) {
    const cas = new InMemoryCAS();
    for (const c of trace.candidates) {
      cas.put(c.recovery.recovery_ref.slice(4), encodeToolEvidence(c.stdout, c.stderr, c.exit_status));
    }
    const run = await runObservationOnlyArmV2(trace, cas, profiles, thresholds, provider);
    if (run.observations === null) {
      throw new Error(`trace ${trace.trace_id} fell back during V2 manifest capture`);
    }
    const request = captured[captured.length - 1];
    for (const view of request.candidate_views) {
      if (!subset.has(view.candidate_id)) continue;
      const prompts = Object.fromEntries(
        MODELED_SEMANTIC_AXES_V2.map((axis) => [
          axis,
          axisPromptV2(request, view.candidate_id, axis),
        ]),
      );
      rows.push(JSON.stringify({
        schema: 'anvil.noul-manifest.v2',
        requestId: request.request_id,
        traceId: trace.trace_id,
        candidateId: view.candidate_id,
        sourceDigest: view.source_digest,
        candidateViewDigest: candidateViewDigestV2(request, view.candidate_id),
        axisSpecDigest: SEMANTIC_AXIS_SPEC_DIGEST_V2,
        decisionContractDigest: decisionContract.digest,
        semanticProgramDigest: request.semantic_program.digest,
        prompts,
      }));
    }
  }

  const labels = mintCampaignLabelsV2({
    traces: corpus,
    decisionContractDigest: decisionContract.digest,
    labelBindingDigest,
  });

  const manifestDigest = sha256Digest(rows.join('\n') + '\n');
  writeFileSync(`${outDir}/noul-manifest-v2.jsonl`, rows.join('\n') + '\n');
  writeFileSync(`${outDir}/corpus-v2-subset.json`, JSON.stringify(corpus, null, 2));
  writeFileSync(`${outDir}/labels-v2.json`, JSON.stringify(labels, null, 2));
  writeFileSync(`${outDir}/campaign-identity-v2.json`, JSON.stringify({
    schema: 'anvil.campaign-identity.v2',
    decisionContract,
    corpusDigest,
    labelBindingDigest,
    manifestDigest,
    axisSpecDigest: SEMANTIC_AXIS_SPEC_DIGEST_V2,
    profiles,
    subsetCandidates: [...subset].sort(),
    subsetCoverage: { scored: subset.size, denominator: 26 },
  }, null, 2));

  console.log(`manifest rows: ${rows.length}`);
  console.log(`labels: ${labels.length}`);
  console.log(`corpusDigest: ${corpusDigest}`);
  console.log(`manifestDigest: ${manifestDigest}`);
  console.log(`decisionContractDigest: ${decisionContract.digest}`);
  console.log(`axisSpecDigest: ${SEMANTIC_AXIS_SPEC_DIGEST_V2}`);
  console.log(`labelBindingDigest: ${labelBindingDigest}`);
}

await main();
