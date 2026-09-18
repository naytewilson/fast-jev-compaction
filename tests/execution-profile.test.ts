import { describe, expect, it } from 'vitest';
import {
  deriveExecutionSemanticsDigest,
  deriveExecutionSemanticsIdentity,
  deriveLocalModelIdentity,
  verifyExecutionSemanticsIdentity,
  verifyLocalModelIdentity,
} from '../src/lab/execution-profile.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

describe('local model and execution identity', () => {
  const model = {
    modelName: 'qwen-local',
    packageDigest: d('1'),
    tokenizerDigest: d('2'),
    weightsDigest: d('3'),
    quantization: 'int4',
    releaseId: 'lab-v1',
  };

  const execution = {
    backend: 'coreml-ane' as const,
    runtimeVersion: 'CoreML-1',
    compilerDigest: d('5'),
    contextWindow: 4096,
    quantization: 'int4',
    samplingDigest: d('6'),
    hardwareSemanticsClass: 'apple-a18pro-ane',
  };

  it('derives and independently verifies a content-verified local model identity', () => {
    const identity = deriveLocalModelIdentity(model);
    expect(identity.assurance).toBe('contentVerified');
    expect(verifyLocalModelIdentity(identity)).toBe(true);
    expect(verifyLocalModelIdentity({
      ...identity,
      tokenizerDigest: d('4'),
    })).toBe(false);
  });

  it('derives a self-verifying execution-semantics identity', () => {
    const identity = deriveExecutionSemanticsIdentity(execution);
    expect(identity.identityDigest).toBe(deriveExecutionSemanticsDigest(execution));
    expect(verifyExecutionSemanticsIdentity(identity)).toBe(true);
    expect(verifyExecutionSemanticsIdentity({
      ...identity,
      runtimeVersion: 'CoreML-2',
    })).toBe(false);
  });

  it('keeps execution semantics sensitive to runtime/backend changes', () => {
    const first = deriveExecutionSemanticsDigest(execution);
    expect(deriveExecutionSemanticsDigest({ ...execution, backend: 'cpu' })).not.toBe(first);
    expect(deriveExecutionSemanticsDigest({ ...execution, runtimeVersion: 'CoreML-2' })).not.toBe(first);
  });

  it('rejects an unknown runtime backend even when TypeScript is bypassed', () => {
    expect(() => deriveExecutionSemanticsDigest({
      ...execution,
      backend: 'invented-backend',
    } as any)).toThrow(/backend/i);
  });

  it('rejects malformed content digests', () => {
    expect(() => deriveLocalModelIdentity({ ...model, packageDigest: 'sha256:BAD' }))
      .toThrow(/canonical sha256/i);
  });
});
