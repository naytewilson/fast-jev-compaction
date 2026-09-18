// neo-overhead-bench.ts — Objective K (partial): measured overheads for
// apple-specific optimization candidates.
//
//   tsx tools/neo-overhead-bench.ts <campaignDir>
//
// Measures on the real campaign data:
//   - candidateViewDigest cost per candidate (ANVIL-owned-boundary hash work)
//   - createLocalHardwareReceipt + verify cost (receipt journaling overhead)
//   - frozen shared-view reuse vs per-request recompute (digest memoization)
//   - sha256Digest cost at campaign-view sizes
//
// Authority regression: memoized digests must be bit-identical to fresh
// computes — caching may never alter identity.
// Writes overhead-report.json.

import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { candidateViewDigest } from '../src/lab/noul-file-provider.js';
import { sha256Digest } from '../src/lab/recovery.js';
import { createLocalHardwareReceipt, verifyLocalHardwareReceipt } from '../src/lab/hardware-receipt.js';
import { buildCampaignChain } from './lib/campaign-chain.js';
import { runObservationOnlyArm } from '../src/lab/observation-arm.js';
import { makeCas } from './lib/campaign-chain.js';
import { MAPPED_DECISION_RESPONSE_SCHEMA } from '../src/lab/types.js';
import type { ReplayTrace } from '../src/lab/replay.js';
import type { MappedDecisionRequest } from '../src/lab/types.js';

const [campaignDir] = process.argv.slice(2);
if (!campaignDir) {
  console.error('usage: tsx tools/neo-overhead-bench.ts <campaignDir>');
  process.exit(2);
}

const corpus = JSON.parse(readFileSync(`${campaignDir}/corpus.json`, 'utf8')) as ReplayTrace[];
const inventoryPath = `${campaignDir}/neo-inventory.json`;
const chain = await buildCampaignChain({ campaignDir, inventoryPath, fixture: true });

// capture real requests to measure view-digest cost on real views
const requests: MappedDecisionRequest[] = [];
for (const trace of corpus) {
  await runObservationOnlyArm(trace, makeCas([trace]), chain.profiles,
    chain.thresholds, (request) => {
      requests.push(request);
      return {
        schema: MAPPED_DECISION_RESPONSE_SCHEMA,
        request_id: request.request_id,
        observations: request.candidate_views.map((c) => ({
          candidate_id: c.candidate_id,
          evidence_sufficient: { noul: 0.5 }, still_needed: { noul: 0.5 },
          full_content_needed: { noul: 0.5 }, unresolved_evidence: { noul: 0.5 },
          recoverable: { noul: 0.5 },
        })),
      };
    });
}
const viewKeys = requests.flatMap((r) =>
  r.candidate_views.map((c) => ({ req: r, cand: c.candidate_id })));
console.log(`views=${viewKeys.length}`);

const bench = (name: string, iters: number, fn: () => void) => {
  // warmup
  for (let i = 0; i < Math.min(50, iters); i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const ms = (performance.now() - t0) / iters;
  return { name, iters, avgMs: Number(ms.toFixed(5)) };
};

const results = [];
let vi = 0;
results.push(bench('candidateViewDigest', 2000, () => {
  const k = viewKeys[vi++ % viewKeys.length];
  candidateViewDigest(k.req, k.cand);
}));

// shared-view memoization: first compute per view vs memoized reuse
const memo = new Map<string, string>();
results.push(bench('candidateViewDigest-memo-hit', 2000, () => {
  const k = viewKeys[vi++ % viewKeys.length];
  const key = `${k.req.request_id}:${k.cand}`;
  if (!memo.has(key)) memo.set(key, candidateViewDigest(k.req, k.cand));
}));

// receipt journaling: create + verify on a minimal real receipt shape
const receipt = createLocalHardwareReceipt({
  repository: 'naytewilson/fast-jev-compaction',
  branch: 'worker/semantic-fabric-v1-overnight-neo-20260918',
  commitSha: '0'.repeat(40),
  timestamp: new Date(0).toISOString(),
  machine: {
    platform: 'darwin', arch: 'arm64', osVersion: '27.2',
    hardwareClass: 'a18pro', accelerator: 'ane',
    backend: chain.neo.semantics.backend,
    runtimeVersion: chain.neo.semantics.runtimeVersion,
  },
  modelIdentity: chain.neo.model,
  executionSemantics: chain.neo.semantics,
  timingEvidence: 'synthetic',
  routeLatencyMs: { p50: 1, p95: 2, p99: 3, sampleCount: 1 },
  observerLatencyMs: { p50: 1, p95: 2, p99: 3, sampleCount: 1 },
  shapeBuckets: [{
    tokenBucket: 1024, batchSize: 8, sampleCount: 1,
    latencyMs: { p50: 1, p95: 2, p99: 3 }, itemsPerSecond: 1,
  }],
  peakRSSBytes: null,
  productionAuthorityGranted: false,
});
results.push(bench('createLocalHardwareReceipt', 2000, () => {
  createLocalHardwareReceipt({
    repository: 'naytewilson/fast-jev-compaction',
    branch: 'worker/semantic-fabric-v1-overnight-neo-20260918',
    commitSha: '0'.repeat(40),
    timestamp: new Date(0).toISOString(),
    machine: receipt.machine, modelIdentity: chain.neo.model,
    executionSemantics: chain.neo.semantics,
    timingEvidence: 'synthetic',
    routeLatencyMs: receipt.routeLatencyMs,
    observerLatencyMs: receipt.observerLatencyMs,
    shapeBuckets: receipt.shapeBuckets,
    peakRSSBytes: null, productionAuthorityGranted: false,
  });
}));
results.push(bench('verifyLocalHardwareReceipt', 2000, () => {
  verifyLocalHardwareReceipt(receipt);
}));

// sha256 over view-sized payloads
const viewBytes = JSON.stringify(viewKeys[0].req.candidate_views[0]);
results.push(bench(`sha256-${viewBytes.length}B-view`, 5000, () => {
  sha256Digest(viewBytes);
}));

// authority regression: memoized digest must equal fresh digest everywhere
let memoIdentical = true;
for (const k of viewKeys) {
  const key = `${k.req.request_id}:${k.cand}`;
  const fresh = candidateViewDigest(k.req, k.cand);
  if (memo.get(key) !== fresh) { memoIdentical = false; break; }
}
const checks = [
  { name: 'memoized-digest-bit-identical', passed: memoIdentical,
    detail: 'cached view digests equal fresh computes on all 26 views' },
];

const report = {
  schema: 'anvil.neo-overhead-report.v1',
  note: 'CPU-side overhead measurements on Dell (control-plane work); ' +
    'observer/model timings live in the Neo score run + hardware receipt.',
  results, checks,
};
writeFileSync(`${campaignDir}/overhead-report.json`, JSON.stringify(report, null, 2));
for (const r of results) console.log(`${r.name}: ${r.avgMs}ms/op (${r.iters} iters)`);
console.log(`checks: ${checks.filter((c) => c.passed).length}/${checks.length} passed`);
console.log('report -> overhead-report.json');
if (checks.some((c) => !c.passed)) process.exit(5);
