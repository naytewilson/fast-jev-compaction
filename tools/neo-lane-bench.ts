// neo-lane-bench.ts — Objective C: measured lane shape compaction.
//
//   tsx tools/neo-lane-bench.ts <campaignDir> [laneCount]
//
// Builds SemanticLanes from the campaign corpus (deterministic token
// estimates per candidate view), replicates them to a lab-scale lane set,
// then measures across bucket/batch configs:
//   - plan time (gather + bucket sort)
//   - reassemble time (strict scatter to original ordinals)
//   - padding waste (packed shape tokens minus real tokens)
//   - lane density (lanes / packed capacity)
//
// Authority regressions:
//   - mask.source=false lanes are excluded from packing
//   - every packed mask is preserved bit-for-bit (no authority widening)
//   - scatter restores original ordinals exactly
//   - unknown/duplicate packed indices fail closed
//
// Writes lane-report.json. All timings measured with performance.now().

import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  planSemanticMicrobatches,
  reassemblePackedLaneResults,
  type SemanticLane,
} from '../src/lab/lane-planner.js';
import { sha256Digest } from '../src/lab/recovery.js';
import type { ReplayTrace } from '../src/lab/replay.js';

const [campaignDir, laneArg] = process.argv.slice(2);
if (!campaignDir) {
  console.error('usage: tsx tools/neo-lane-bench.ts <campaignDir> [laneCount]');
  process.exit(2);
}
const laneCount = Number(laneArg ?? '5000');

const corpus = JSON.parse(readFileSync(`${campaignDir}/corpus.json`, 'utf8')) as ReplayTrace[];
const manifest = readFileSync(`${campaignDir}/noul-manifest.jsonl`, 'utf8')
  .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const tokensByCandidate = new Map<string, number>();
for (const row of manifest) {
  // v2 rows carry promptTokens; v1 rows carry per-axis prompt strings —
  // estimate tokens as chars/4 over the longest axis prompt.
  if (row.promptTokens) {
    tokensByCandidate.set(row.candidateId, row.promptTokens);
  } else if (row.prompts) {
    const longest = Math.max(
      ...Object.values(row.prompts as Record<string, string>).map((p) => p.length));
    tokensByCandidate.set(row.candidateId, Math.ceil(longest / 4));
  }
}

// Deterministic lane factory: corpus candidates replicated with a stable
// tokenEstimate jitter so multiple shape buckets are exercised.
const lanes: SemanticLane[] = [];
const base = corpus.flatMap((t) => t.candidates.map((c) => ({
  id: c.candidate_id,
  digest: c.recovery.source_digest,
  est: tokensByCandidate.get(c.candidate_id) ??
    Math.max(64, c.stdout.length + c.stderr.length),
})));
for (let i = 0; i < laneCount; i++) {
  const b = base[i % base.length];
  lanes.push({
    originalOrdinal: i,
    candidateId: `cand-lane-${i.toString().padStart(6, '0')}`,
    sourceDigest: b.digest,
    tokenEstimate: b.est + (i % 5) * 16, // deterministic jitter within bucket
    mask: {
      source: i % 97 !== 0, // ~1% source-masked lanes must be excluded
      evidence: true, calibration: false, authority: false, recovery: true,
    },
  });
}
console.log(`lanes=${lanes.length} corpusCandidates=${base.length}`);

const configs = [
  { name: 'coarse-2', shapeBuckets: [256, 1024], maxBatchSize: 8 },
  { name: 'medium-4', shapeBuckets: [256, 512, 768, 1024], maxBatchSize: 8 },
  { name: 'fine-8', shapeBuckets: [128, 256, 384, 512, 640, 768, 896, 1024], maxBatchSize: 8 },
  { name: 'fine-8-b16', shapeBuckets: [128, 256, 384, 512, 640, 768, 896, 1024], maxBatchSize: 16 },
];

const checks: { name: string; passed: boolean; detail: string }[] = [];
const runs: unknown[] = [];
for (const cfg of configs) {
  const t0 = performance.now();
  const plan = planSemanticMicrobatches(lanes, cfg);
  const planMs = performance.now() - t0;

  const realTokens = plan.packedLanes.reduce((a, l) => a + l.tokenEstimate, 0);
  const packedTokens = plan.batches.reduce(
    (a, b) => a + b.shapeBucket * b.lanes.length, 0);
  const waste = packedTokens - realTokens;

  const t1 = performance.now();
  const results = plan.packedLanes.map((l) => ({
    packedIndex: l.packedIndex,
    candidateId: l.candidateId,
    value: { scored: true, mask: l.mask },
  }));
  const reassembled = reassemblePackedLaneResults(plan, results);
  const scatterMs = performance.now() - t1;

  const ordinalsOk = reassembled.every((r, i) =>
    r.originalOrdinal === plan.packedLanes[i].originalOrdinal &&
    r.candidateId === lanes[r.originalOrdinal].candidateId);
  runs.push({
    config: cfg.name, planMs: Number(planMs.toFixed(3)),
    scatterMs: Number(scatterMs.toFixed(3)),
    packedLanes: plan.packedLanes.length, batches: plan.batches.length,
    realTokens, packedTokens, wasteTokens: waste,
    density: Number((realTokens / packedTokens).toFixed(4)),
    ordinalsRestored: ordinalsOk,
  });
}

// ---- authority + integrity regressions
const plan = planSemanticMicrobatches(lanes, configs[1]);
checks.push({
  name: 'source-masked-lanes-excluded',
  passed: plan.packedLanes.every((l) => l.mask.source) &&
    plan.packedLanes.length < lanes.length,
  detail: `${lanes.length - plan.packedLanes.length} lanes excluded`,
});
checks.push({
  name: 'mask-preserved-no-widening',
  passed: plan.packedLanes.every((l) => {
    const src = lanes[l.originalOrdinal];
    return src.mask.source === l.mask.source &&
      src.mask.evidence === l.mask.evidence &&
      src.mask.calibration === l.mask.calibration &&
      src.mask.authority === l.mask.authority &&
      src.mask.recovery === l.mask.recovery &&
      !l.mask.authority; // packing may never mint authority
  }),
  detail: 'every packed mask bit-identical; authority=false preserved',
});
const fullResults = plan.packedLanes.map((l) => ({
  packedIndex: l.packedIndex, candidateId: l.candidateId, value: 1,
}));
checks.push({
  name: 'scatter-restores-ordinals',
  passed: reassemblePackedLaneResults(plan, fullResults)
    .every((r, i) =>
      r.originalOrdinal === plan.packedLanes[i].originalOrdinal &&
      r.candidateId === lanes[r.originalOrdinal].candidateId &&
      (i === 0 || r.originalOrdinal >
        plan.packedLanes[i - 1].originalOrdinal)),
  detail: 'strict original-ordinal restoration over eligible lanes',
});
checks.push({
  name: 'missing-packed-index-fails', passed: (() => {
    try { reassemblePackedLaneResults(plan, fullResults.slice(1)); return false; }
    catch { return true; }
  })(), detail: '',
});
checks.push({
  name: 'duplicate-packed-index-fails', passed: (() => {
    try {
      reassemblePackedLaneResults(plan, [...fullResults, fullResults[0]]);
      return false;
    } catch { return true; }
  })(), detail: '',
});
checks.push({
  name: 'candidate-identity-mismatch-fails', passed: (() => {
    try {
      const bad = fullResults.map((r, i) =>
        i === 0 ? { ...r, candidateId: 'cand-forged' } : r);
      reassemblePackedLaneResults(plan, bad);
      return false;
    } catch { return true; }
  })(), detail: '',
});
checks.push({
  name: 'duplicate-candidate-id-fails', passed: (() => {
    try {
      planSemanticMicrobatches(
        [{ ...lanes[0] }, { ...lanes[0], originalOrdinal: 1 }],
        configs[0]);
      return false;
    } catch { return true; }
  })(), detail: '',
});

const report = {
  schema: 'anvil.neo-lane-report.v1',
  laneCount,
  corpusCandidates: base.length,
  tokenEstimateSource: 'manifest promptTokens (fallback: evidence byte length)',
  runs,
  checks,
};
writeFileSync(`${campaignDir}/lane-report.json`, JSON.stringify(report, null, 2));
for (const r of runs as { config: string; planMs: number; scatterMs: number; batches: number; density: number; wasteTokens: number }[]) {
  console.log(`${r.config}: plan=${r.planMs}ms scatter=${r.scatterMs}ms batches=${r.batches} density=${r.density} waste=${r.wasteTokens}`);
}
console.log(`checks: ${checks.filter((c) => c.passed).length}/${checks.length} passed`);
console.log('report -> lane-report.json');
if (checks.some((c) => !c.passed)) {
  console.error('FAILURES PRESENT');
  process.exit(5);
}
