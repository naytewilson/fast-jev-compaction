// parse-score-log-v2.mjs — CausalStepperMac score log -> noul v2 jsonl
//
// Joins SCORE_BEGIN {key} -> PROBE_JSON {probs,abs} -> SCORE_END {ms}
// into anvil.noul-observation.v2 records: exactly the four V2 modeled
// axes, conditional yes/no probabilities for policy consumption, and
// per-axis telemetry preserving BOTH the probe-subset conditional probs
// and the absolute full-vocabulary probs. Telemetry is measurement
// evidence — never semantic authority.
//
//   node tools/parse-score-log-v2.mjs <score.log> <out.jsonl> \
//     --profile <sha256:...> --axis-spec <sha256:...>
import { readFileSync, writeFileSync } from 'node:fs';

const YES = new Set(['11683', '12447', '18171', '17550']);
const NO = new Set(['2243', '4547', '794', '2752']);
const AXES = ['evidence_sufficient', 'still_needed', 'full_content_needed', 'unresolved_evidence'];

const args = process.argv.slice(2);
const [logPath, outPath] = args.filter((a) => !a.startsWith('--'));
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const profileDigest = flag('--profile');
const axisSpecDigest = flag('--axis-spec');
if (!logPath || !outPath || !profileDigest || !axisSpecDigest) {
  console.error('usage: parse-score-log-v2.mjs <score.log> <out.jsonl> --profile <digest> --axis-spec <digest>');
  process.exit(2);
}
if (!/^sha256:[0-9a-f]{64}$/.test(profileDigest) || !/^sha256:[0-9a-f]{64}$/.test(axisSpecDigest)) {
  console.error('--profile and --axis-spec must be canonical sha256 digests');
  process.exit(2);
}

const lines = readFileSync(logPath, 'utf8').split('\n');
const rows = new Map();
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
        schema: 'anvil.noul-observation.v2',
        candidateViewDigest: cur.candidateViewDigest,
        requestId: cur.requestId,
        candidateId: cur.candidateId,
        providerProfileDigest: profileDigest,
        axisSpecDigest,
        axisProbabilities: {},
        promptDigests: {},
        probeMode: 'conditional',
        yesTokenIds: [...YES].map(Number),
        noTokenIds: [...NO].map(Number),
        telemetry: {},
        timingsMs: { prefill: 0, decode: 0 },
        _ms: {},
      });
    }
    const rec = rows.get(key);
    const probeAxes = new Map();
    for (const p of cur.probes ?? []) {
      if (typeof p.offset === 'number' && p.axis) {
        probeAxes.set(p.offset % 16, p.axis);
      }
    }
    const expected = probeAxes.size > 0 ? probeAxes.size : 0;
    if (cur._probes.length !== expected) {
      console.error(`row ${cur.row}: expected ${expected} PROBE_JSON got ${cur._probes.length} — partial row`);
    }
    for (const probe of cur._probes) {
      const axis = probeAxes.get(probe.offset);
      if (!axis) {
        console.error(`row ${cur.row}: PROBE_JSON offset=${probe.offset} has no mapped axis — skipped`);
        continue;
      }
      if (!AXES.includes(axis)) {
        console.error(`row ${cur.row}: non-V2 axis '${axis}' — rejected`);
        continue;
      }
      let yes = 0, no = 0;
      for (const [id, p] of Object.entries(probe.probs ?? {})) {
        if (YES.has(id)) yes += p;
        if (NO.has(id)) no += p;
      }
      rec.axisProbabilities[axis] = Number(yes.toFixed(8));
      rec.promptDigests[axis] = cur.promptDigest;
      rec.telemetry[axis] = { probs: probe.probs ?? {}, abs: probe.abs ?? {} };
      rec._ms[axis] = end.ms;
    }
    cur = null;
  }
}

const complete = [];
let partial = 0;
for (const rec of rows.values()) {
  const n = Object.keys(rec.axisProbabilities).length;
  if (n === AXES.length) {
    rec.timingsMs.prefill = Object.values(rec._ms).reduce((a, b) => a + b, 0) / n;
    delete rec._ms;
    complete.push(rec);
  } else partial += 1;
}
writeFileSync(outPath, complete.map((r) => JSON.stringify(r)).join('\n') + (complete.length ? '\n' : ''));
console.log(`complete=${complete.length} partial=${partial} -> ${outPath}`);
