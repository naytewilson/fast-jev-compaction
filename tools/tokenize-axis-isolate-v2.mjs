// Tokenizes the first-slot axis-isolate manifest.
//
// Each row contains exactly one axis question and exactly one answer marker.
// The probe is always the final token position, so no later question is
// conditioned on missing earlier answers.
//
// Usage:
//   node tools/tokenize-axis-isolate-v2.mjs <manifest.jsonl> <tokenizer.json> <out.jsonl>

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Tokenizer } from 'tokenizers';

const [inPath, tokPath, outPath] = process.argv.slice(2);
if (!inPath || !tokPath || !outPath) {
  console.error('usage: tokenize-axis-isolate-v2.mjs <manifest.jsonl> <tokenizer.json> <out.jsonl>');
  process.exit(2);
}

const tok = await Tokenizer.fromFile(tokPath);
const DOT = 22;
const AXES = new Set([
  'evidence_sufficient',
  'still_needed',
  'full_content_needed',
  'unresolved_evidence',
]);

const rows = readFileSync(inPath, 'utf8')
  .split('\n')
  .filter((line) => line.trim());
const out = [];

for (const line of rows) {
  const row = JSON.parse(line);
  if (row.schema !== 'anvil.axis-isolate-manifest.v2') {
    throw new Error(`unexpected isolate manifest schema for ${row.candidateId}`);
  }
  if (!AXES.has(row.axis) || (row.target !== 0 && row.target !== 1)) {
    throw new Error(`invalid isolate axis/target for ${row.candidateId}`);
  }
  if (typeof row.prompt !== 'string' || !row.prompt.includes('Question:')) {
    throw new Error(`missing isolate prompt for ${row.candidateId}`);
  }

  // The source prompt already ends at <|im_start|>assistant. Append one
  // neutral answer slot only. Encode the complete string once so the probe
  // identity reflects the exact tokenizer behavior at the boundary.
  const prompt = row.prompt + '1=';
  const encoded = (await tok.encode(prompt)).getIds();
  const pad = (16 - (encoded.length % 16)) % 16;
  const ids = [
    ...encoded.slice(0, 3),
    ...Array(pad).fill(DOT),
    ...encoded.slice(3),
  ];
  if (ids.length % 16 !== 0) throw new Error('axis isolate alignment failed');

  const offset = ids.length - 1;
  const lastWin = ids.length - 16;
  if (offset < lastWin) throw new Error('axis isolate probe outside last window');

  out.push(JSON.stringify({
    schema: 'anvil.axis-isolate-ids.v2',
    requestId: row.requestId,
    traceId: row.traceId,
    candidateId: row.candidateId,
    candidateViewDigest: row.candidateViewDigest,
    sourceDigest: row.sourceDigest,
    axisSpecDigest: row.axisSpecDigest,
    axis: row.axis,
    target: row.target,
    promptTokens: ids.length,
    promptDigest: 'sha256:' + createHash('sha256')
      .update(JSON.stringify(ids))
      .digest('hex'),
    probes: [{ axis: row.axis, offset }],
    prompt_ids: ids,
  }));
}

if (out.length !== 16) {
  throw new Error(`axis isolate must tokenize exactly 16 rows, got ${out.length}`);
}
writeFileSync(outPath, out.join('\n') + '\n');
console.log(`rows=${out.length} probeLayout=single-first-slot -> ${outPath}`);
