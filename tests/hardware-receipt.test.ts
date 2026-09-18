import { describe, expect, it } from 'vitest';
import {
  deriveExecutionSemanticsIdentity,
  deriveLocalModelIdentity,
} from '../src/lab/execution-profile.js';
import {
  createLocalHardwareReceipt,
  verifyLocalHardwareReceipt,
} from '../src/lab/hardware-receipt.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

function modelIdentity() {
  return deriveLocalModelIdentity({
    modelName: 'qwen-local',
    packageDigest: d('1'),
    tokenizerDigest: d('2'),
    weightsDigest: d('3'),
    quantization: 'int4',
    releaseId: 'lab-v1',
  });
}

function executionIdentity() {
  return deriveExecutionSemanticsIdentity({
    backend: 'coreml-ane',
    runtimeVersion: 'CoreML-1',
    compilerDigest: d('5'),
    contextWindow: 4096,
    quantization: 'int4',
    samplingDigest: d('6'),
    hardwareSemanticsClass: 'apple-a18pro-ane',
  });
}

function input(timingEvidence: 'measured' | 'synthetic' = 'measured') {
  return {
    repository: 'naytewilson/fast-jev-compaction',
    branch: 'north/semantic-fabric-trust-boundary-v1',
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
    modelIdentity: modelIdentity(),
    executionSemantics: executionIdentity(),
    timingEvidence,
    routeLatencyMs: { p50: 0.2, p95: 0.5, p99: 0.8, sampleCount: 1000 },
    observerLatencyMs: { p50: 1.2, p95: 1.9, p99: 2.4, sampleCount: 1000 },
    shapeBuckets: [
      {
        tokenBucket: 16,
        batchSize: 1,
        sampleCount: 100,
        latencyMs: { p50: 0.8, p95: 1.1, p99: 1.4 },
        itemsPerSecond: 150,
      },
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
  it('creates and verifies a measured source-bound receipt with recomputable identities', () => {
    const receipt = createLocalHardwareReceipt(input());
    expect(receipt.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(receipt.productionAuthorityGranted).toBe(false);
    expect(receipt.modelIdentity.assurance).toBe('contentVerified');
    expect(verifyLocalHardwareReceipt(receipt)).toBe(true);
  });

  it('detects embedded model identity tampering', () => {
    const receipt = createLocalHardwareReceipt(input());
    expect(verifyLocalHardwareReceipt({
      ...receipt,
      modelIdentity: { ...receipt.modelIdentity, tokenizerDigest: d('9') },
    })).toBe(false);
  });

  it('keeps synthetic timing syntactically valid but explicit', () => {
    const receipt = createLocalHardwareReceipt(input('synthetic'));
    expect(verifyLocalHardwareReceipt(receipt)).toBe(true);
    expect(receipt.timingEvidence).toBe('synthetic');
  });

  it('requires canonical ISO timestamps', () => {
    expect(() => createLocalHardwareReceipt({
      ...input(),
      timestamp: '2026-09-18 00:00:00Z',
    })).toThrow(/canonical ISO/i);
  });

  it('rejects duplicate or non-canonical shape ordering', () => {
    const duplicate = input();
    duplicate.shapeBuckets = [duplicate.shapeBuckets[0], duplicate.shapeBuckets[0]];
    expect(() => createLocalHardwareReceipt(duplicate)).toThrow(/shapeBuckets/i);

    const reversed = input();
    reversed.shapeBuckets = [...reversed.shapeBuckets].reverse();
    expect(() => createLocalHardwareReceipt(reversed)).toThrow(/shapeBuckets/i);
  });

  it('rejects impossible percentile ordering', () => {
    const bad = input();
    bad.routeLatencyMs = { p50: 2, p95: 1, p99: 3, sampleCount: 10 };
    expect(() => createLocalHardwareReceipt(bad)).toThrow(/percentile/i);
  });
});
