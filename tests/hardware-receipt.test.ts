import { describe, expect, it } from 'vitest';
import {
  createLocalHardwareReceipt,
  verifyLocalHardwareReceipt,
} from '../src/lab/hardware-receipt.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

function input(timingEvidence: 'measured' | 'synthetic' = 'measured') {
  return {
    repository: 'naytewilson/fast-jev-compaction',
    branch: 'north/authority-preserving-semantic-fabric-v1',
    commitSha: 'a'.repeat(40),
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
    modelAssurance: 'contentVerified' as const,
    executionSemanticsDigest: d('2'),
    timingEvidence,
    routeLatencyMs: { p50: 0.2, p95: 0.5, p99: 0.8, sampleCount: 1000 },
    observerLatencyMs: { p50: 1.2, p95: 1.9, p99: 2.4, sampleCount: 1000 },
    shapeBuckets: [
      {
        tokenBucket: 32,
        batchSize: 4,
        sampleCount: 100,
        latencyMs: { p50: 1, p95: 2, p99: 3 },
        itemsPerSecond: 120,
      },
    ],
    peakRSSBytes: 123456789,
    productionAuthorityGranted: false as const,
  };
}

describe('local hardware measurement receipt', () => {
  it('creates and verifies a measured source-bound receipt', () => {
    const receipt = createLocalHardwareReceipt(input());
    expect(receipt.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(receipt.productionAuthorityGranted).toBe(false);
    expect(verifyLocalHardwareReceipt(receipt)).toBe(true);
  });

  it('detects measurement tampering', () => {
    const receipt = createLocalHardwareReceipt(input());
    const tampered = {
      ...receipt,
      observerLatencyMs: { ...receipt.observerLatencyMs, p99: 9 },
    };
    expect(verifyLocalHardwareReceipt(tampered)).toBe(false);
  });

  it('keeps synthetic timing syntactically valid but explicit', () => {
    const receipt = createLocalHardwareReceipt(input('synthetic'));
    expect(verifyLocalHardwareReceipt(receipt)).toBe(true);
    expect(receipt.timingEvidence).toBe('synthetic');
  });

  it('rejects impossible percentile ordering', () => {
    const bad = input();
    bad.routeLatencyMs = { p50: 2, p95: 1, p99: 3, sampleCount: 10 };
    expect(() => createLocalHardwareReceipt(bad)).toThrow(/percentile/i);
  });
});
