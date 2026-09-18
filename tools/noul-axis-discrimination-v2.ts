// Builds the deterministic 16-anchor V2 axis-discrimination campaign.
//
// This tool intentionally preserves the existing V2 axis wording, probe
// questions, normalizer/token classes, and observation ABI. It changes only
// the source-bound candidate corpus used to test positive-vs-negative ordering.
//
//   npx tsx tools/noul-axis-discrimination-v2.ts [outDir]

import { mkdirSync, writeFileSync } from 'node:fs';
import {
  axisDiscriminationAnchorPlanV2,
  axisDiscriminationCorpusV2,
  verifyAxisDiscriminationCorpusV2,
} from '../src/lab/axis-discrimination-v2.js';
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

const outDir = process.argv[2] ?? 'artifacts/neo-axis-discrimination-v2';
mkdirSync(outDir, { recursive: true });

function axisPromptV2(
  request: SemanticDecisionRequestV2,
  candidateId: string,
  axis: ModeledSemanticAxisV2,
): string {
  const view = request.candidate_views.find((candidate) =>
    candidate.candidate_id === candidateId);
  if (!view) throw new Error(`unknown candidate ${candidateId}`);
  const semanticView = view.semantic_view;
  const hardRoots = view.hard_roots;
  return [
    '<|im_start|>system',
    'You are a precise evidence classifier inside a deterministic audit pipeline.',
    'Answer the question about the tool-output evidence with exactly one word: Yes or No.',
    '<|im_end|>',
    '<|im_start|>user',
    `Mission: ${request.shared_conversation_state.mission}`,
    '',
    `Exit status: ${hardRoots.exit_status}`,
    hardRoots.stderr.length > 0
      ? `Stderr: ${hardRoots.stderr.join(' | ')}`
      : 'Stderr: (none)',
    '',
    '--- evidence head ---',
    semanticView.head,
    '--- evidence tail ---',
    semanticView.tail,
    `(${semanticView.omitted_bytes} bytes omitted between head and tail)`,
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
      observations: request.candidate_views.map((candidate) => ({
        candidate_id: candidate.candidate_id,
        evidence_sufficient: { noul: 0.5 },
        still_needed: { noul: 0.5 },
        full_content_needed: { noul: 0.5 },
        unresolved_evidence: { noul: 0.5 },
      })),
    };
  };
}

async function main(): Promise<void> {
  const corpus = axisDiscriminationCorpusV2();
  const coverage = verifyAxisDiscriminationCorpusV2(corpus);
  const anchorPlan = axisDiscriminationAnchorPlanV2();

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
  const anchorPlanDigest = sha256Digest(JSON.stringify(anchorPlan));
  const labelBindingDigest = sha256Digest(JSON.stringify({
    schema: 'anvil.label-binding.v2',
    corpusId: 'anvil.axis-discrimination-corpus.v2',
    corpusDigest,
    verifierIdentity: 'anvil.mechanical-source-verifier.v2',
    generation: 1,
    axisSpecDigest: SEMANTIC_AXIS_SPEC_DIGEST_V2,
    anchorPlanDigest,
  }));

  const profiles: ObservationProfilesV2 = {
    decision_contract: decisionContract,
    execution_profile: {
      id: 'neo-lfm2.5-local-v2',
      version: '2.0.0',
      digest: sha256Digest('axis-discrimination-exec-placeholder-v2'),
    },
    calibration_profile: {
      id: 'axis-discrimination-shadow-v2',
      version: '2.0.0',
      digest: sha256Digest('axis-discrimination-cal-v2'),
    },
    policy_profile: {
      id: 'axis-discrimination-shadow-policy-v2',
      version: '2.0.0',
      digest: sha256Digest('axis-discrimination-policy-v2'),
    },
  };

  const captured: SemanticDecisionRequestV2[] = [];
  const provider = captureProvider(captured);
  const rows: string[] = [];

  for (const trace of corpus) {
    const cas = new InMemoryCAS();
    for (const candidate of trace.candidates) {
      cas.put(
        candidate.recovery.recovery_ref.slice(4),
        encodeToolEvidence(
          candidate.stdout,
          candidate.stderr,
          candidate.exit_status,
        ),
      );
    }

    const before = captured.length;
    const run = await runObservationOnlyArmV2(
      trace,
      cas,
      profiles,
      thresholds,
      provider,
    );
    if (run.observations === null) {
      throw new Error(
        `trace ${trace.trace_id} fell back during V2 anchor manifest capture`,
      );
    }
    if (captured.length !== before + 1) {
      throw new Error(
        `trace ${trace.trace_id} did not produce exactly one captured request`,
      );
    }

    const request = captured[captured.length - 1];
    for (const view of request.candidate_views) {
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
        candidateViewDigest: candidateViewDigestV2(
          request,
          view.candidate_id,
        ),
        axisSpecDigest: SEMANTIC_AXIS_SPEC_DIGEST_V2,
        decisionContractDigest: decisionContract.digest,
        semanticProgramDigest: request.semantic_program.digest,
        prompts,
      }));
    }
  }

  if (rows.length !== 16) {
    throw new Error(
      `axis discrimination manifest must contain exactly 16 rows, got ${rows.length}`,
    );
  }

  const labels = mintCampaignLabelsV2({
    traces: corpus,
    decisionContractDigest: decisionContract.digest,
    labelBindingDigest,
  });
  const manifestBytes = rows.join('\n') + '\n';
  const manifestDigest = sha256Digest(manifestBytes);

  writeFileSync(
    `${outDir}/noul-manifest-v2.jsonl`,
    manifestBytes,
  );
  writeFileSync(
    `${outDir}/corpus-v2-subset.json`,
    JSON.stringify(corpus, null, 2) + '\n',
  );
  writeFileSync(
    `${outDir}/labels-v2.json`,
    JSON.stringify(labels, null, 2) + '\n',
  );
  writeFileSync(
    `${outDir}/anchor-plan-v2.json`,
    JSON.stringify({
      schema: 'anvil.axis-discrimination-anchor-plan.v2',
      axisSpecDigest: SEMANTIC_AXIS_SPEC_DIGEST_V2,
      anchorPlanDigest,
      anchors: anchorPlan,
      mechanicalCoverage: coverage,
    }, null, 2) + '\n',
  );
  writeFileSync(
    `${outDir}/campaign-identity-v2.json`,
    JSON.stringify({
      schema: 'anvil.axis-discrimination-campaign-identity.v2',
      experimentKind: 'positive-negative-axis-discrimination',
      decisionContract,
      corpusDigest,
      labelBindingDigest,
      manifestDigest,
      anchorPlanDigest,
      axisSpecDigest: SEMANTIC_AXIS_SPEC_DIGEST_V2,
      profiles,
      subsetCandidates: corpus.map(
        (trace) => trace.candidates[0].candidate_id,
      ).sort(),
      subsetCoverage: { scored: corpus.length, denominator: corpus.length },
      mechanicalCoverage: coverage,
      promotionAuthority: 'NONE',
    }, null, 2) + '\n',
  );

  console.log(`manifest rows: ${rows.length}`);
  console.log(`labels: ${labels.length}`);
  console.log(`corpusDigest: ${corpusDigest}`);
  console.log(`manifestDigest: ${manifestDigest}`);
  console.log(`axisSpecDigest: ${SEMANTIC_AXIS_SPEC_DIGEST_V2}`);
  console.log(`anchorPlanDigest: ${anchorPlanDigest}`);
  console.log(`labelBindingDigest: ${labelBindingDigest}`);
  console.log('promotionAuthority=NONE');
}

await main();
