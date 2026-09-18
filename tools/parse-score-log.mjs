// parse-score-log.mjs — CausalStepperMac score log -> noul.jsonl
//
// Joins SCORE_BEGIN {key} -> PROBE_JSON {probs,abs} -> SCORE_END {ms}
// into anvil.noul-observation.v1 records grouped by candidate, with
// axisProbabilities = sum of yes-class subset probabilities
// (probs are already normalized across the 8 probe ids).
import { readFileSync, writeFileSync } from 'node:fs';

const YES = new Set(['11683', '12447', '18171', '17550']);
const NO = new Set(['2243', '4547', '794', '2752']);

const [logPath, outPath] = process.argv.slice(2);
if (!logPath || !outPath) {
  console.error('usage: node parse-score-log.mjs <score.log> <noul.jsonl>');
  process.exit(2);
}

const lines = readFileSync(logPath, 'utf8').split('\n');
const rows = new Map(); // candidateKey -> {key fields, axes:{axis:{prob,ms}}, }
let cur = null;
for (const line of lines) {
  if (line.startsWith('SCORE_BEGIN ')) {
    cur = JSON.parse(line.slice('SCORE_BEGIN '.length));
    cur._probes = [];
  } else if (line.startsWith('PROBE_JSON ') && cur) {
    cur._probes.push(JSON.parse(line.slice('PROBE_JSON '.length)));
  } else if (line.startsWith('SCORE_END ') && cur) {
    const end = JSON.parse(line.slice('SCORE_END '.length));
    const key = `${cur.requestId}:${cur.candidateId}`;
    if (!rows.has(key)) {
      rows.set(key, {
        schema: 'anvil.noul-observation.v1',
        candidateViewDigest: cur.candidateViewDigest,
        requestId: cur.requestId,
        candidateId: cur.candidateId,
        axisProbabilities: {},
        probeMode: 'conditional',
        yesTokenIds: [...YES].map(Number),
        noTokenIds: [...NO].map(Number),
        promptDigests: {},
        timingsMs: { prefill: 0, decode: 0 },
        _ms: {},
      });
    }
    const rec = rows.get(key);
    // v2: SCORE_BEGIN.probes maps each probe offset to an axis; v1: cur.axis
    const probeAxes = new Map();
    for (const p of cur.probes ?? []) {
      if (typeof p.offset === 'number' && p.axis) probeAxes.set(p.offset, p.axis);
    }
    const expected = probeAxes.size > 0 ? probeAxes.size : 1;
    if (cur._probes.length !== expected) {
      console.error(`row ${cur.row}: expected ${expected} PROBE_JSON got ${cur._probes.length} — axis data for this row may be partial`);
    }
    for (const probe of cur._probes) {
      const axis = probeAxes.size > 0 ? probeAxes.get(probe.offset) : cur.axis;
      if (!axis) {
        console.error(`row ${cur.row}: PROBE_JSON offset=${probe.offset} has no mapped axis — skipped`);
        continue;
      }
      let yes = 0, no = 0;
      for (const [id, p] of Object.entries(probe.probs ?? {})) {
        if (YES.has(id)) yes += p;
        if (NO.has(id)) no += p;
      }
      rec.axisProbabilities[axis] = Number(yes.toFixed(8));
      rec.promptDigests[axis] = cur.promptDigest;
      rec._ms[axis] = end.ms;
    }
    cur = null;
  }
}

const complete = [];
let partial = 0;
for (const rec of rows.values()) {
  const n = Object.keys(rec.axisProbabilities).length;
  if (n === 5) {
    rec.timingsMs.prefill = Object.values(rec._ms).reduce((a, b) => a + b, 0) / n;
    delete rec._ms;
    complete.push(rec);
  } else partial += 1;
}
writeFileSync(outPath, complete.map((r) => JSON.stringify(r)).join('\n') + (complete.length ? '\n' : ''));
console.log(`complete=${complete.length} partial=${partial} -> ${outPath}`);
