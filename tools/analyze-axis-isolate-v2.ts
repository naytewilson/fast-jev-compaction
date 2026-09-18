// Analyzes the first-slot isolate diagnostic against the parent measured
// multi-slot observations.
//
// Usage:
//   npx tsx tools/analyze-axis-isolate-v2.ts //     <isolateDir> <observations.jsonl> <parentObservations.jsonl>

import { readFileSync, writeFileSync } from 'node:fs';
import {
  analyzeAxisIsolateV2,
  type AxisIsolateManifestRowV2,
  type AxisIsolateObservationV2,
  type ParentAxisObservationV2,
} from '../src/lab/axis-isolate-diagnostic-v2.js';

const [isolateDir, observationsPath, parentObservationsPath] =
  process.argv.slice(2);
if (!isolateDir || !observationsPath || !parentObservationsPath) {
  console.error(
    'usage: analyze-axis-isolate-v2.ts <isolateDir> <observations.jsonl> <parentObservations.jsonl>',
  );
  process.exit(2);
}

const identity = JSON.parse(
  readFileSync(`${isolateDir}/axis-isolate-identity-v2.json`, 'utf8'),
) as {
  schema: string;
  providerProfileDigest: string;
  axisSpecDigest: string;
  promotionAuthority: string;
};
if (identity.schema !== 'anvil.axis-isolate-identity.v2') {
  throw new Error('axis isolate identity schema mismatch');
}
if (identity.promotionAuthority !== 'NONE') {
  throw new Error('axis isolate identity may not carry promotion authority');
}

const manifest = readFileSync(
  `${isolateDir}/axis-isolate-manifest-v2.jsonl`,
  'utf8',
).trim().split('\n').map((line) => JSON.parse(line)) as AxisIsolateManifestRowV2[];
const observations = readFileSync(observationsPath, 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line)) as AxisIsolateObservationV2[];
const parentObservations = readFileSync(parentObservationsPath, 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line)) as ParentAxisObservationV2[];

for (const observation of observations) {
  if (observation.providerProfileDigest !== identity.providerProfileDigest) {
    throw new Error(
      `axis isolate provider profile drift for ${observation.candidateId}`,
    );
  }
  if (observation.axisSpecDigest !== identity.axisSpecDigest) {
    throw new Error(
      `axis isolate axis-spec drift for ${observation.candidateId}`,
    );
  }
}

const report = analyzeAxisIsolateV2({
  manifest,
  observations,
  parentObservations,
});

writeFileSync(
  `${isolateDir}/axis-isolate-report-v2.json`,
  JSON.stringify({
    ...report,
    providerProfileDigest: identity.providerProfileDigest,
    axisSpecDigest: identity.axisSpecDigest,
    experimentKind: 'first-slot-primary-axis-isolate',
    interpretation: [
      'The first-slot isolate tests whether the prior multi-slot layout suppressed registered Yes/No answer-token mass at later probe positions.',
      'Ordering is interpreted only when every isolated row meets the answerability floor.',
      'This report does not change semantic wording, thresholds, recovery authority, or production policy.',
    ],
  }, null, 2) + '\n',
);

console.log(`allRowsAnswerable=${report.allRowsAnswerable}`);
console.log(`decision=${report.decision}`);
for (const [axis, metrics] of Object.entries(report.axes)) {
  console.log(
    `${axis}: class=${metrics.classification} pairwise=${metrics.pairwiseOrderingRate.toFixed(4)} isolateMassMean=${metrics.answerTokenMass.mean.toFixed(6)} parentMassMean=${metrics.parentAnswerTokenMass.mean.toFixed(6)}`,
  );
}
console.log('promotionAuthority=NONE');
