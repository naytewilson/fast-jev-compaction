// Builds the 16-row first-slot isolate diagnostic from the measured
// axis-discrimination battery. Each candidate keeps only its designated
// primary axis/question and is later tokenized with a single answer marker.
//
// Usage:
//   npx tsx tools/noul-axis-isolate-v2.ts <parentCampaignDir> <outDir>

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  buildAxisIsolateManifestV2,
  type AxisIsolateAnchorV2,
  type AxisIsolateSourceManifestRowV2,
} from '../src/lab/axis-isolate-diagnostic-v2.js';

const [parentDir, outDir] = process.argv.slice(2);
if (!parentDir || !outDir) {
  console.error('usage: noul-axis-isolate-v2.ts <parentCampaignDir> <outDir>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

function sha256Bytes(bytes: Buffer | string): string {
  return 'sha256:' + createHash('sha256').update(bytes).digest('hex');
}

const sourceBytes = readFileSync(`${parentDir}/noul-manifest-v2.jsonl`);
const sourceRows = sourceBytes
  .toString('utf8')
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line)) as AxisIsolateSourceManifestRowV2[];
const anchorPlanBytes = readFileSync(`${parentDir}/anchor-plan-v2.json`);
const anchorPlan = JSON.parse(anchorPlanBytes.toString('utf8')) as {
  axisSpecDigest: string;
  anchorPlanDigest: string;
  anchors: AxisIsolateAnchorV2[];
};
const parentReportBytes = readFileSync(
  `${parentDir}/axis-discrimination-report-v2.json`,
);
const parentReport = JSON.parse(parentReportBytes.toString('utf8')) as {
  providerProfileDigest: string;
  axisSpecDigest: string;
  replayDigest: string;
  observationsDigest: string;
  rawScoreLogDigest: string | null;
  promotionAuthority: string;
};

if (parentReport.promotionAuthority !== 'NONE') {
  throw new Error('parent discrimination report unexpectedly carries authority');
}
if (parentReport.axisSpecDigest !== anchorPlan.axisSpecDigest) {
  throw new Error('parent axis-spec binding mismatch');
}

const rows = buildAxisIsolateManifestV2({
  sourceRows,
  anchors: anchorPlan.anchors,
});
const manifestBytes = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
const manifestDigest = sha256Bytes(manifestBytes);

writeFileSync(`${outDir}/axis-isolate-manifest-v2.jsonl`, manifestBytes);
writeFileSync(
  `${outDir}/axis-isolate-identity-v2.json`,
  JSON.stringify({
    schema: 'anvil.axis-isolate-identity.v2',
    experimentKind: 'first-slot-primary-axis-isolate',
    parentManifestDigest: sha256Bytes(sourceBytes),
    parentAnchorPlanFileDigest: sha256Bytes(anchorPlanBytes),
    parentAnchorPlanDigest: anchorPlan.anchorPlanDigest,
    parentReportDigest: sha256Bytes(parentReportBytes),
    parentReplayDigest: parentReport.replayDigest,
    parentObservationsDigest: parentReport.observationsDigest,
    parentRawScoreLogDigest: parentReport.rawScoreLogDigest,
    providerProfileDigest: parentReport.providerProfileDigest,
    axisSpecDigest: parentReport.axisSpecDigest,
    manifestDigest,
    rows: rows.length,
    probeLayout: 'single-primary-axis-first-answer-slot',
    nonAuthoritative: true,
    promotionAuthority: 'NONE',
  }, null, 2) + '\n',
);

console.log(`rows=${rows.length}`);
console.log(`manifestDigest=${manifestDigest}`);
console.log(`providerProfileDigest=${parentReport.providerProfileDigest}`);
console.log(`axisSpecDigest=${parentReport.axisSpecDigest}`);
console.log('probeLayout=single-primary-axis-first-answer-slot');
console.log('promotionAuthority=NONE');
