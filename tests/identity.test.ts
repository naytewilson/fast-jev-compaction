import { describe, expect, it } from 'vitest';
import {
  deriveAuthorityIdentity,
  deriveCalibrationIdentity,
  digestTaggedIdentity,
} from '../src/lab/identity.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

const calibrationInput = {
  decisionContractDigest: d('1'),
  compiledProgramDigest: d('2'),
  executionSemanticsDigest: d('3'),
  modelIdentityDigest: d('4'),
  normalizerDigest: d('5'),
  trainingMerkleRoot: d('6'),
  holdoutMerkleRoot: d('7'),
  samplingPolicyDigest: d('8'),
  labelAuthorityPolicyDigest: d('9'),
  datasetGenerationDigest: d('a'),
  labelBindingDigest: d('b'),
  calibratorSpecDigest: d('c'),
  fittedParametersDigest: d('d'),
} as const;

describe('semantic fabric public identities', () => {
  it('derives a stable calibration identity and changes on any execution/calibration input', () => {
    const first = deriveCalibrationIdentity(calibrationInput);
    const second = deriveCalibrationIdentity(calibrationInput);
    const changed = deriveCalibrationIdentity({
      ...calibrationInput,
      fittedParametersDigest: d('e'),
    });

    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect(changed).not.toBe(first);
  });

  it('keeps policy changes out of CalibrationIdentity but inside AuthorityIdentity', () => {
    const calibrationIdentity = deriveCalibrationIdentity(calibrationInput);
    const a = deriveAuthorityIdentity({
      calibrationIdentity,
      policyProfileDigest: d('e'),
      observationABIDigest: d('f'),
    });
    const b = deriveAuthorityIdentity({
      calibrationIdentity,
      policyProfileDigest: d('0'),
      observationABIDigest: d('f'),
    });

    expect(b).not.toBe(a);
    expect(deriveCalibrationIdentity(calibrationInput)).toBe(calibrationIdentity);
  });

  it('domain-separates otherwise identical tagged material', () => {
    const components = [{ tag: 1, data: Buffer.from('same') }];
    expect(digestTaggedIdentity('ANVIL.CalibrationIdentity.v2', components))
      .not.toBe(digestTaggedIdentity('ANVIL.AuthorityIdentity.v2', components));
  });

  it('rejects malformed digest inputs instead of silently normalizing them', () => {
    expect(() => deriveCalibrationIdentity({
      ...calibrationInput,
      modelIdentityDigest: 'sha256:BAD',
    })).toThrow(/canonical sha256/i);
  });
});
