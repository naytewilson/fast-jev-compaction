import { describe, expect, it } from 'vitest';
import { createLocalHardwareReceipt } from '../src/lab/hardware-receipt.js';
import { evaluateLocalProfileReceipt } from '../src/lab/local-profile-gate.js';

const d = (c: string) => 'sha256:' + c.repeat(64);
const sha = 'a'.repeat(40);

function receipt(overrides: Record<string, unknown> = {}) {
  return createLocalHardwareReceipt({
    repository: 'naytewilson/fast-jev-compaction',
    branch: 'north/authority-preserving-semantic-fabric-v1',
    commitSha: sha,
    timestamp: '2026-09-18T00:00:00.000Z',
    machine: {
      platform: 'macOS',
      arch: 'arm64',
      osVersion: '27.0',
      hardwareClass: 'A18 Pro',
      accelerator: 'ANE',
      backend: 'coreml-ane',
      runtimeVersion: 'CoreML-1',
    },
    modelIdentityDigest: d('1'),
    modelAssurance: 'contentVerified',
    executionSemanticsDigest: d('2'),
    timingEvidence: 'measured',
    routeLatencyMs: { p50: 0.2, p95: 0.5, p99: 0.8, sampleCount: 100 },
    observerLatencyMs: { p50: 1, p95: 2, p99: 3, sampleCount: 100 },
    shapeBuckets: [{
      tokenBucket: 32,
      batchSize: 4,
      sampleCount: 100,
      latencyMs: { p50: 1, p95: 2, p99: 3 },
      itemsPerSecond: 120,
    }],
    peakRSSBytes: null,
    productionAuthorityGranted: false,
    ...overrides,
  });
}

const expected = {
  repository: 'naytewilson/fast-jev-compaction',
  branch: 'north/authority-preserving-semantic-fabric-v1',
  commitSha: sha,
  platform: 'macOS',
  arch: 'arm64',
  accelerator: 'ANE',
  timingEvidence: 'measured' as const,
};

describe('local execution profile measurement gate', () => {
  it('accepts an exact measured ANE receipt without granting authority', () => {
    const result = evaluateLocalProfileReceipt(receipt(), expected);
    expect(result).toEqual({
      status: 'MEASUREMENT_ACCEPTED_NO_AUTHORITY',
      reasons: [],
      productionAuthorityGranted: false,
    });
  });

  it('rejects exact-SHA or provenance mismatch', () => {
    expect(evaluateLocalProfileReceipt(receipt(), { ...expected, commitSha: 'b'.repeat(40) }).status)
      .toBe('REJECTED');
  });

  it('rejects synthetic timing for hardware acceptance', () => {
    expect(evaluateLocalProfileReceipt(receipt({ timingEvidence: 'synthetic' }), expected).status)
      .toBe('REJECTED');
  });

  it('rejects a non-ANE backend for the ANE campaign', () => {
    const r = receipt({
      machine: {
        platform: 'macOS',
        arch: 'arm64',
        osVersion: '27.0',
        hardwareClass: 'A18 Pro',
        accelerator: 'CPU',
        backend: 'cpu',
        runtimeVersion: 'CoreML-1',
      },
    });
    expect(evaluateLocalProfileReceipt(r, expected).status).toBe('REJECTED');
  });

  it('rejects model assurance below contentVerified for the first local campaign', () => {
    const r = receipt({ modelAssurance: 'opaqueVersioned' });
    expect(evaluateLocalProfileReceipt(r, expected).status).toBe('REJECTED');
  });
});
