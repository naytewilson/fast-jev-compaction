// Parses CausalStepperMac score output for the first-slot isolate diagnostic.
//
// Usage:
//   node tools/parse-axis-isolate-log-v2.mjs <score.log> <out.jsonl> //     --profile <sha256:...> --axis-spec <sha256:...>

import { readFileSync, writeFileSync } from 'node:fs';

const YES = new Set(['11683', '12447', '18171', '17550']);
const NO = new Set(['2243', '4547', '794', '2752']);
const AXES = new Set([
  'evidence_sufficient',
  'still_needed',
  'full_content_needed',
  'unresolved_evidence',
]);

const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith('--'));
const [logPath, outPath] = positional;
const flag = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const providerProfileDigest = flag('--profile');
const axisSpecDigest = flag('--axis-spec');

if (!logPath || !outPath || !providerProfileDigest || !axisSpecDigest) {
  console.error(
    'usage: parse-axis-isolate-log-v2.mjs <score.log> <out.jsonl> --profile <digest> --axis-spec <digest>',
  );
  process.exit(2);
}
const digestPattern = /^sha256:[0-9a-f]{64}$/;
if (
  !digestPattern.test(providerProfileDigest) ||
  !digestPattern.test(axisSpecDigest)
) {
  throw new Error('--profile and --axis-spec must be canonical sha256 digests');
}

const lines = readFileSync(logPath, 'utf8').split('\n');
const observations = [];
const seen = new Set();
let current = null;

for (const line of lines) {
  if (line.startsWith('SCORE_BEGIN ')) {
    if (current !== null) {
      throw new Error('nested SCORE_BEGIN in isolate score log');
    }
    const begin = JSON.parse(line.slice('SCORE_BEGIN '.length));
    const probes = begin.probes ?? [];
    if (
      probes.length !== 1 ||
      !AXES.has(probes[0].axis) ||
      begin.axis !== probes[0].axis
    ) {
      throw new Error(`isolate row ${begin.row} does not carry exactly one bound axis probe`);
    }
    current = { begin, probes: [] };
    continue;
  }

  if (line.startsWith('PROBE_JSON ') && current !== null) {
    current.probes.push(JSON.parse(line.slice('PROBE_JSON '.length)));
    continue;
  }

  if (line.startsWith('SCORE_END ') && current !== null) {
    const end = JSON.parse(line.slice('SCORE_END '.length));
    const { begin, probes } = current;
    if (probes.length !== 1) {
      throw new Error(
        `isolate row ${begin.row} expected exactly 1 PROBE_JSON, got ${probes.length}`,
      );
    }

    const probe = probes[0];
    const expectedOffset = begin.probes[0].offset % 16;
    if (probe.offset !== expectedOffset) {
      throw new Error(
        `isolate row ${begin.row} probe offset mismatch expected=${expectedOffset} observed=${probe.offset}`,
      );
    }

    let yesAbs = 0;
    let noAbs = 0;
    for (const [id, probability] of Object.entries(probe.abs ?? {})) {
      if (YES.has(id)) yesAbs += probability;
      if (NO.has(id)) noAbs += probability;
    }
    const answerTokenMass = yesAbs + noAbs;
    if (!(answerTokenMass > 0 && answerTokenMass <= 1)) {
      throw new Error(
        `isolate row ${begin.row} invalid answer-token mass ${answerTokenMass}`,
      );
    }
    const probability = yesAbs / answerTokenMass;

    const key = `${begin.requestId}:${begin.candidateId}`;
    if (seen.has(key)) {
      throw new Error(`duplicate isolate score row ${key}`);
    }
    seen.add(key);

    observations.push({
      schema: 'anvil.axis-isolate-observation.v2',
      requestId: begin.requestId,
      candidateId: begin.candidateId,
      candidateViewDigest: begin.candidateViewDigest,
      providerProfileDigest,
      axisSpecDigest,
      axis: begin.axis,
      probability,
      yesAbs,
      noAbs,
      answerTokenMass,
      promptDigest: begin.promptDigest,
      timingMs: end.ms,
    });
    current = null;
  }
}

if (current !== null) {
  throw new Error('unterminated isolate SCORE_BEGIN at end of log');
}
if (observations.length !== 16) {
  throw new Error(
    `axis isolate requires exactly 16 complete rows, got ${observations.length}`,
  );
}

writeFileSync(
  outPath,
  observations.map((row) => JSON.stringify(row)).join('\n') + '\n',
);
console.log(`complete=${observations.length} partial=0 -> ${outPath}`);
