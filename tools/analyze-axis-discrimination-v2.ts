// Consumes measured anvil.noul-observation.v2 records from the real Neo
// scorer and produces the source-bound positive-vs-negative discrimination
// report for the deterministic 16-anchor V2 battery.
//
// Usage:
//   npx tsx tools/analyze-axis-discrimination-v2.ts \\
//     <campaignDir> <noulV2.jsonl> <inventory.json> [raw-score.log]

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  analyzeAxisDiscriminationV2,
  verifyAxisDiscriminationCorpusV2,
} from '../src/lab/axis-discrimination-v2.js';
import {
  createNoulFileProviderV2,
  loadNoulLogV2,
  neoLfmIdentityV2,
} from '../src/lab/noul-file-provider-v2.js';
import {
  compileContextRetentionProgramV2,
  MODELED_SEMANTIC_AXES_V2,
} from '../src/lab/semantic-contract-v2.js';
import {
  ProviderShadowReplayCompilerV2,
  verifyProviderShadowReplayArtifactV2,
} from '../src/lab/provider-shadow-replay-v2.js';
import {
  InMemoryCAS,
  encodeToolEvidence,
} from '../src/lab/recovery.js';
import { SEMANTIC_AXIS_SPEC_DIGEST_V2 } from '../src/lab/semantic-axis-spec-v2.js';
import type { ReplayTrace } from '../src/lab/replay.js';
import type { SemanticCalibrationLabelV2 } from '../src/lab/semantic-label-v2.js';
import type {
  ObservationPolicyThresholdsV2,
  ObservationProfilesV2,
} from '../src/lab/observation-arm-v2.js';

const [campaignDir, noulPath, inventoryPath, rawScorePath] =
  process.argv.slice(2);
if (!campaignDir || !noulPath || !inventoryPath) {
  console.error(
    'usage: analyze-axis-discrimination-v2.ts <campaignDir> <noulV2.jsonl> <inventory.json> [raw-score.log]',
  );
  process.exit(2);
}

function sha256File(path: string): string {
  const bytes = readFileSync(path);
  return 'sha256:' + createHash('sha256').update(bytes).digest('hex');
}

const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
const identity = JSON.parse(
  readFileSync(`${campaignDir}/campaign-identity-v2.json`, 'utf8'),
);
const corpus = JSON.parse(
  readFileSync(`${campaignDir}/corpus-v2-subset.json`, 'utf8'),
) as ReplayTrace[];
const labels = JSON.parse(
  readFileSync(`${campaignDir}/labels-v2.json`, 'utf8'),
) as SemanticCalibrationLabelV2[];
const records = loadNoulLogV2(noulPath);

verifyAxisDiscriminationCorpusV2(corpus);

if (identity.schema !== 'anvil.axis-discrimination-campaign-identity.v2') {
  throw new Error('axis discrimination campaign identity schema mismatch');
}
if (identity.axisSpecDigest !== SEMANTIC_AXIS_SPEC_DIGEST_V2) {
  throw new Error(
    `axis discrimination identity binds stale axis spec ${identity.axisSpecDigest}`,
  );
}
if (identity.promotionAuthority !== 'NONE') {
  throw new Error('axis discrimination campaign may not carry promotion authority');
}

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

const expectedCandidateIDs = new Set<string>(
  corpus.flatMap((trace) =>
    trace.candidates.map((candidate) => candidate.candidate_id)),
);
const measuredCandidateIDs = new Set<string>();
for (const record of records) {
  if (measuredCandidateIDs.has(record.candidateId)) {
    throw new Error(`duplicate measured record for ${record.candidateId}`);
  }
  measuredCandidateIDs.add(record.candidateId);
  if (!expectedCandidateIDs.has(record.candidateId)) {
    throw new Error(
      `measured record for unregistered axis anchor ${record.candidateId}`,
    );
  }
  if (record.providerProfileDigest !== neo.profile.providerProfileDigest) {
    throw new Error(
      `record ${record.candidateId} binds stale provider profile ${record.providerProfileDigest}`,
    );
  }
  if (record.axisSpecDigest !== SEMANTIC_AXIS_SPEC_DIGEST_V2) {
    throw new Error(
      `record ${record.candidateId} binds stale axis spec ${record.axisSpecDigest}`,
    );
  }
}
for (const candidateID of expectedCandidateIDs) {
  if (!measuredCandidateIDs.has(candidateID)) {
    throw new Error(`measured record missing for axis anchor ${candidateID}`);
  }
}
if (records.length !== 16) {
  throw new Error(
    `axis discrimination experiment requires exactly 16 complete measured records, got ${records.length}`,
  );
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
const program = compileContextRetentionProgramV2(
  observationProfiles.decision_contract,
);
const thresholds: ObservationPolicyThresholdsV2 = {
  evidenceSufficientFloor: 0.8,
  retain: 0.5,
  keepFull: 0.8,
  reviewFloor: 0.8,
};

const cas = new InMemoryCAS();
for (const trace of corpus) {
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
}

const provider = createNoulFileProviderV2(records, {
  expectedProfileDigest: neo.profile.providerProfileDigest,
});
const artifact = await new ProviderShadowReplayCompilerV2().compile({
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
  throw new Error('axis discrimination replay artifact failed self-verification');
}

const discrimination = analyzeAxisDiscriminationV2({
  labels,
  predictions: artifact.predictions,
});

const classCode = {
  ORDERING_GOOD_BIAS_ONLY: 'A',
  OVERLAPPING_BUT_USABLE: 'B',
  NON_DISCRIMINATING: 'C',
  INVERTED: 'D',
} as const;

const axes = Object.fromEntries(
  MODELED_SEMANTIC_AXES_V2.map((axis) => {
    const metrics = discrimination.axes[axis];
    return [axis, {
      ...metrics,
      classificationCode: classCode[metrics.classification],
    }];
  }),
);

const wallTimesMs = records.map((record) => record.timingsMs.prefill);
const report = {
  schema: 'anvil.axis-discrimination-measured-report.v2',
  evidenceClass: 'measured-local-inference',
  experimentKind: 'positive-negative-axis-discrimination',
  observationAbi: 'anvil.semantic-observation-abi.v2',
  retentionContract: 'anvil.context-retention.v2',
  providerId: neo.profile.providerId,
  providerProfileDigest: neo.profile.providerProfileDigest,
  decisionContractDigest: observationProfiles.decision_contract.digest,
  compiledProgramDigest: program.programDigest,
  axisSpecDigest: SEMANTIC_AXIS_SPEC_DIGEST_V2,
  labelBindingDigest: identity.labelBindingDigest,
  anchorPlanDigest: identity.anchorPlanDigest,
  corpusDigest: identity.corpusDigest,
  replayDigest: artifact.replayDigest,
  candidateCount: records.length,
  predictionCount: artifact.predictions.length,
  receiptDigests: artifact.receiptDigests,
  observationsDigest: sha256File(noulPath),
  rawScoreLogDigest: rawScorePath ? sha256File(rawScorePath) : null,
  wallTimeMs: {
    samples: wallTimesMs.length,
    values: wallTimesMs,
    total: wallTimesMs.reduce((sum, value) => sum + value, 0),
    mean: wallTimesMs.reduce((sum, value) => sum + value, 0) /
      wallTimesMs.length,
  },
  axes,
  fullExpansionJustified: discrimination.fullExpansionJustified,
  semanticsRepairAxes: discrimination.semanticsRepairAxes,
  providerFitBlockerAxes: discrimination.providerFitBlockerAxes,
  decision:
    discrimination.fullExpansionJustified
      ? 'PROCEED_TO_CALIBRATION_THEN_26_ROW_EXPANSION'
      : discrimination.providerFitBlockerAxes.length > 0
        ? 'STOP_EXPANSION_INVESTIGATE_PROVIDER_PROBE_FIT'
        : 'STOP_EXPANSION_REPAIR_FAILING_AXIS_SEMANTICS',
  nonAuthoritative: true,
  promotionAuthority: 'NONE',
  notes: [
    'Classification is based on positive-vs-negative ordering, not a production threshold.',
    'accuracyAt05 and Brier are descriptive only.',
    'A=ORDERING_GOOD_BIAS_ONLY, B=OVERLAPPING_BUT_USABLE, C=NON_DISCRIMINATING, D=INVERTED.',
    'Experiment identity failures are fail-closed tool errors and must be reported as E=INVALID_EXPERIMENT.',
    'No threshold, promotion policy, modeled recovery axis, or production authority is changed by this report.',
  ],
};

writeFileSync(
  `${campaignDir}/axis-discrimination-report-v2.json`,
  JSON.stringify(report, null, 2) + '\n',
);

console.log(`providerProfileDigest=${neo.profile.providerProfileDigest}`);
console.log(`axisSpecDigest=${SEMANTIC_AXIS_SPEC_DIGEST_V2}`);
console.log(`replayDigest=${artifact.replayDigest}`);
for (const axis of MODELED_SEMANTIC_AXES_V2) {
  const metrics = discrimination.axes[axis];
  console.log(
    `${axis}: ${classCode[metrics.classification]} ${metrics.classification} pairwise=${metrics.pairwiseOrderingRate.toFixed(4)} meanGap=${metrics.meanPositiveMinusMeanNegative.toFixed(6)} minPosMinusMaxNeg=${metrics.minPositiveMinusMaxNegative.toFixed(6)}`,
  );
}
console.log(`fullExpansionJustified=${discrimination.fullExpansionJustified}`);
console.log(`decision=${report.decision}`);
console.log('promotionAuthority=NONE');
