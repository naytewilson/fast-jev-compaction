import { describe, expect, it } from 'vitest';
import {
  deriveExecutionSemanticsDigest,
  deriveLocalModelIdentity,
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

  it('derives content-verified local model identity and changes on content/quantization', () => {
    const a = deriveLocalModelIdentity(model);
    const b = deriveLocalModelIdentity(model);
    const changedTokenizer = deriveLocalModelIdentity({ ...model, tokenizerDigest: d('4') });
    const changedQuant = deriveLocalModelIdentity({ ...model, quantization: 'fp16' });

    expect(a.assurance).toBe('contentVerified');
    expect(a.identityDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(b.identityDigest).toBe(a.identityDigest);
    expect(changedTokenizer.identityDigest).not.toBe(a.identityDigest);
    expect(changedQuant.identityDigest).not.toBe(a.identityDigest);
  });

  it('keeps execution semantics separate and sensitive to runtime/backend changes', () => {
    const base = {
      backend: 'coreml-ane' as const,
      runtimeVersion: 'CoreML-1',
      compilerDigest: d('5'),
      contextWindow: 4096,
      quantization: 'int4',
      samplingDigest: d('6'),
      hardwareSemanticsClass: 'apple-a18pro-ane',
    };

    const first = deriveExecutionSemanticsDigest(base);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(deriveExecutionSemanticsDigest({ ...base, backend: 'cpu' })).not.toBe(first);
    expect(deriveExecutionSemanticsDigest({ ...base, runtimeVersion: 'CoreML-2' })).not.toBe(first);
  });

  it('rejects malformed content digests', () => {
    expect(() => deriveLocalModelIdentity({ ...model, packageDigest: 'sha256:BAD' }))
      .toThrow(/canonical sha256/i);
  });
});
