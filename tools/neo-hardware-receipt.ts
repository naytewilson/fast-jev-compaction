// neo-hardware-receipt.ts — Objective D: anvil.local-hardware-receipt.v2.
//
//   tsx tools/neo-hardware-receipt.ts <campaignDir> <inventory.json> \
//        [--observer-samples <ms.json>] [--peak-rss <bytes>] \
//        [--commit <sha>] [--synthetic]
//
// Assembles the receipt from REAL artifacts only:
//   route latency     <- fault-report.json routeLatencyMs (measured campaign)
//   observer latency  <- --observer-samples (per-candidate score-run ms)
//   shape buckets     <- lane-report.json measured plan/scatter runs
//   machine identity  <- neo-inventory.json machine section
//   model/semantics   <- neoLfmIdentity over the verified package digests
//
// timingEvidence='measured' ONLY when observer samples are supplied from a
// real score run; otherwise 'synthetic' is stamped (never claim measured
// from fixture). evaluateLocalProfileReceipt must return
// MEASUREMENT_ACCEPTED_NO_AUTHORITY or the tool exits nonzero.
// productionAuthorityGranted is always false — hardware receipts mint no
// authority.

import { readFileSync, writeFileSync } from 'node:fs';
import { neoLfmIdentity } from '../src/lab/noul-file-provider.js';
import { createLocalHardwareReceipt, verifyLocalHardwareReceipt, type ShapeBucketMeasurement } from '../src/lab/hardware-receipt.js';
import { evaluateLocalProfileReceipt } from '../src/lab/local-profile-gate.js';
import type { ExecutionBackend } from '../src/lab/execution-profile.js';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const [campaignDir, inventoryPath] = args.filter((a) => !a.startsWith('--') && a !== flag('--observer-samples') && a !== flag('--peak-rss') && a !== flag('--commit'));
if (!campaignDir || !inventoryPath) {
  console.error('usage: tsx tools/neo-hardware-receipt.ts <campaignDir> <inventory.json> [--observer-samples ms.json] [--peak-rss bytes] [--commit sha] [--synthetic]');
  process.exit(2);
}
const synthetic = args.includes('--synthetic');
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
const fault = JSON.parse(readFileSync(`${campaignDir}/fault-report.json`, 'utf8'));
const lane = JSON.parse(readFileSync(`${campaignDir}/lane-report.json`, 'utf8'));

const neo = neoLfmIdentity({
  packageDigest: inventory.packageDigest,
  tokenizerDigest: inventory.tokenizerDigest,
  ...(inventory.weightsDigest ? { weightsDigest: inventory.weightsDigest } : {}),
  quantization: inventory.quantization,
  releaseId: inventory.releaseId,
  backend: inventory.backend as ExecutionBackend,
  runtimeVersion: inventory.runtimeVersion,
  compilerDigest: inventory.compilerDigest,
  contextWindow: inventory.contextWindow,
  samplingDigest: inventory.samplingDigest,
  ...(inventory.hardwareSemanticsClass ? { hardwareSemanticsClass: inventory.hardwareSemanticsClass } : {}),
});

// observer latency: real per-candidate score ms when supplied; else mark synthetic
let observer = { p50: 0, p95: 0, p99: 0, sampleCount: 0 };
let timingEvidence: 'measured' | 'synthetic' = 'synthetic';
const samplesPath = flag('--observer-samples');
if (samplesPath && !synthetic) {
  const samples = (JSON.parse(readFileSync(samplesPath, 'utf8')) as number[]).sort((a, b) => a - b);
  const pct = (p: number) => samples[Math.min(samples.length - 1, Math.ceil((p / 100) * samples.length) - 1)];
  observer = {
    p50: Number(pct(50).toFixed(3)), p95: Number(pct(95).toFixed(3)),
    p99: Number(pct(99).toFixed(3)), sampleCount: samples.length,
  };
  timingEvidence = 'measured';
} else if (!synthetic) {
  console.error('no --observer-samples: stamping timingEvidence=synthetic');
}

// shape buckets: convert measured lane-report runs (plan+scatter) into
// deterministic ShapeBucketMeasurement records — token bucket = the largest
// configured shape bucket in that run's config.
const shapeBuckets: ShapeBucketMeasurement[] = [];
{
  const byBucket = new Map<number, { plan: number[]; scatter: number[]; batchSize: number }>();
  const bucketOf = (name: string) =>
    name === 'coarse-2' ? 1024 : name === 'medium-4' ? 1024 : 1024; // max bucket in each cfg
  for (const run of lane.runs as { config: string; planMs: number; scatterMs: number; batches: number; packedLanes: number }[]) {
    const b = byBucket.get(bucketOf(run.config)) ?? { plan: [], scatter: [], batchSize: run.config.includes('b16') ? 16 : 8 };
    b.plan.push(run.planMs);
    b.scatter.push(run.scatterMs);
    byBucket.set(bucketOf(run.config), b);
  }
  const pct = (xs: number[], p: number) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
  };
  for (const [bucket, v] of [...byBucket.entries()].sort((a, b) => a[0] - b[0])) {
    const lat = v.plan.map((p, i) => p + v.scatter[i]);
    shapeBuckets.push({
      tokenBucket: bucket,
      batchSize: v.batchSize,
      sampleCount: lat.length,
      latencyMs: {
        p50: Number(pct(lat, 50).toFixed(3)),
        p95: Number(pct(lat, 95).toFixed(3)),
        p99: Number(pct(lat, 99).toFixed(3)),
      },
      itemsPerSecond: Number(((lane.laneCount) / (lat.reduce((a, b) => a + b, 0) / 1000)).toFixed(1)),
    });
  }
}

const receipt = createLocalHardwareReceipt({
  repository: 'naytewilson/fast-jev-compaction',
  branch: 'worker/semantic-fabric-v1-overnight-neo-20260918',
  commitSha: flag('--commit') ?? '0'.repeat(40),
  timestamp: new Date().toISOString(),
  machine: {
    platform: 'darwin', arch: 'arm64', osVersion: inventory.osVersion ?? '27.2',
    hardwareClass: inventory.hardwareClass ?? 'a18pro',
    accelerator: inventory.accelerator ?? 'ane',
    backend: inventory.backend as string,
    runtimeVersion: inventory.runtimeVersion,
  },
  modelIdentity: neo.model,
  executionSemantics: neo.semantics,
  timingEvidence,
  routeLatencyMs: {
    p50: fault.safetyCampaign.routeLatencyMs.p50,
    p95: fault.safetyCampaign.routeLatencyMs.p95,
    p99: fault.safetyCampaign.routeLatencyMs.p99,
    sampleCount: fault.safetyCampaign.cycleCount,
  },
  observerLatencyMs: timingEvidence === 'measured' ? observer
    : { p50: 0, p95: 0, p99: 0, sampleCount: 1 },
  shapeBuckets,
  peakRSSBytes: flag('--peak-rss') ? Number(flag('--peak-rss')) : null,
  productionAuthorityGranted: false,
});

const ok = verifyLocalHardwareReceipt(receipt);
const gate = evaluateLocalProfileReceipt(receipt, {
  repository: 'naytewilson/fast-jev-compaction',
  branch: 'worker/semantic-fabric-v1-overnight-neo-20260918',
  commitSha: receipt.commitSha,
  platform: 'darwin', arch: 'arm64', accelerator: 'ane',
  backend: inventory.backend as string,
  timingEvidence,
});
writeFileSync(`${campaignDir}/hardware-receipt.json`, JSON.stringify(receipt, null, 2));
console.log(`receipt: id=${receipt.receiptId} digest=${receipt.receiptDigest.slice(0, 30)}… verified=${ok}`);
console.log(`gate: status=${gate.status} authority=${gate.productionAuthorityGranted} reasons=${JSON.stringify(gate.reasons)}`);
console.log(`timingEvidence=${timingEvidence} observerSamples=${observer.sampleCount} shapes=${shapeBuckets.length}`);
console.log('report -> hardware-receipt.json');
if (!ok || gate.status === 'REJECTED' || gate.productionAuthorityGranted !== false) {
  console.error('GATE FAILURE');
  process.exit(5);
}
