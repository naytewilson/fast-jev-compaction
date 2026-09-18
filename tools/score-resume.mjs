#!/usr/bin/env node
// score-resume.mjs — emit a reduced manifest containing only unscored rows.
//
//   node tools/score-resume.mjs <manifest.jsonl> <score.log> <out.jsonl>
//
// Rows in the score log are indexed in manifest order; SCORE_END {row:N}
// marks manifest row N complete. The output manifest preserves the
// original row objects verbatim (digests stay bound); the restarted score
// run logs row indices relative to the reduced manifest, so merge logs
// by candidateId at parse time — never by row index across runs.
import { readFileSync, writeFileSync } from 'node:fs';

const [manifestPath, logPath, outPath] = process.argv.slice(2);
if (!manifestPath || !logPath || !outPath) {
  console.error('usage: score-resume.mjs <manifest.jsonl> <score.log> <out.jsonl>');
  process.exit(2);
}

const manifest = readFileSync(manifestPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const done = new Set();
for (const line of readFileSync(logPath, 'utf8').split('\n')) {
  if (!line.startsWith('SCORE_END ')) continue;
  const rec = JSON.parse(line.slice('SCORE_END '.length));
  done.add(rec.row);
}

const remaining = manifest.filter((_, i) => !done.has(i));
writeFileSync(outPath, remaining.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`total=${manifest.length} done=${done.size} remaining=${remaining.length} -> ${outPath}`);
if (remaining.length === 0) console.log('NOTHING_TO_RESUME');
