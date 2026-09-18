// extract-observer-samples.mjs — pull per-candidate observer wall times
// from a CausalStepperMac score log for the hardware receipt.
//
//   node tools/extract-observer-samples.mjs <score.log> <out.json>
//
// Emits a JSON array of per-SCORE_END ms values (one per completed row),
// plus a stderr summary. Real measured values only — rows without a
// completed SCORE_END are ignored.
import { readFileSync, writeFileSync } from 'node:fs';

const [logPath, outPath] = process.argv.slice(2);
if (!logPath || !outPath) {
  console.error('usage: node extract-observer-samples.mjs <score.log> <out.json>');
  process.exit(2);
}
const lines = readFileSync(logPath, 'utf8').split('\n');
const samples = [];
for (const line of lines) {
  if (line.startsWith('SCORE_END ')) {
    const end = JSON.parse(line.slice('SCORE_END '.length));
    if (typeof end.ms === 'number' && Number.isFinite(end.ms) && end.ms >= 0) {
      samples.push(Number(end.ms.toFixed(3)));
    }
  }
}
samples.sort((a, b) => a - b);
writeFileSync(outPath, JSON.stringify(samples));
console.log(`samples=${samples.length} -> ${outPath}`);
if (samples.length > 0) {
  const pct = (p) => samples[Math.min(samples.length - 1, Math.ceil((p / 100) * samples.length) - 1)];
  console.log(`p50=${pct(50)}ms p95=${pct(95)}ms p99=${pct(99)}ms`);
}
