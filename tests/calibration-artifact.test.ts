import { describe, expect, it } from 'vitest';
import {
  ProviderCalibrationArtifactRegistry,
  verifyProviderCalibrationArtifact,
} from '../src/lab/calibration-artifact.js';
import { makeArtifact, makeCalibrators, makeProviderProfile, d } from './provider-authority-fixtures.js';

describe('ProviderCalibrationArtifact', () => {
  it('registers a complete five-predicate provider-bound artifact', () => {
    const { artifact, providerProfile } = makeArtifact();
    expect(artifact.schema).toBe('anvil.provider-calibration-artifact.v1');
    expect(artifact.providerProfileDigest).toBe(providerProfile.providerProfileDigest);
    expect(artifact.calibrators).toHaveLength(5);
    expect(artifact.calibrationIdentity).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(verifyProviderCalibrationArtifact(artifact)).toBe(true);
  });

  it('rejects missing or duplicate predicate calibrators', () => {
    const profile = makeProviderProfile();
    const calibrators = makeCalibrators(profile.providerProfileDigest);
    const base = {
      providerProfile: profile,
      decisionContractDigest: d('e'),
      compiledProgramDigest: d('f'),
      dataset: {
        trainingMerkleRoot: d('1'),
        holdoutMerkleRoot: d('2'),
        samplingPolicyDigest: d('3'),
        labelAuthorityPolicyDigest: d('4'),
        datasetGenerationDigest: d('d'),
      },
      labelBindingDigest: d('5'),
    };

    expect(() => new ProviderCalibrationArtifactRegistry().register({
      ...base,
      calibrators: calibrators.slice(0, 4),
    })).toThrow(/five|predicate/i);

    expect(() => new ProviderCalibrationArtifactRegistry().register({
      ...base,
      calibrators: [...calibrators.slice(0, 4), calibrators[0]],
    })).toThrow(/duplicate|predicate/i);
  });

  it('rejects a calibrator fitted for a different provider profile', () => {
    const profile = makeProviderProfile();
    const other = makeProviderProfile('neo/qwen-ane');
    const calibrators = makeCalibrators(profile.providerProfileDigest);
    calibrators[2] = makeCalibrators(other.providerProfileDigest)[2];

    expect(() => new ProviderCalibrationArtifactRegistry().register({
      providerProfile: profile,
      decisionContractDigest: d('e'),
      compiledProgramDigest: d('f'),
      dataset: {
        trainingMerkleRoot: d('1'),
        holdoutMerkleRoot: d('2'),
        samplingPolicyDigest: d('3'),
        labelAuthorityPolicyDigest: d('4'),
        datasetGenerationDigest: d('d'),
      },
      labelBindingDigest: d('5'),
      calibrators,
    })).toThrow(/provider profile/i);
  });

  it('rejects tampered fitted calibrator identity', () => {
    const profile = makeProviderProfile();
    const calibrators = makeCalibrators(profile.providerProfileDigest);
    calibrators[0] = { ...calibrators[0], fittedParametersDigest: d('0') };

    expect(() => new ProviderCalibrationArtifactRegistry().register({
      providerProfile: profile,
      decisionContractDigest: d('e'),
      compiledProgramDigest: d('f'),
      dataset: {
        trainingMerkleRoot: d('1'),
        holdoutMerkleRoot: d('2'),
        samplingPolicyDigest: d('3'),
        labelAuthorityPolicyDigest: d('4'),
        datasetGenerationDigest: d('d'),
      },
      labelBindingDigest: d('5'),
      calibrators,
    })).toThrow(/calibrator|fitted/i);
  });

  it('changes calibration identity when dataset generation or provider identity changes', () => {
    const a = makeArtifact('typesafe-system-one/jev-1.13.0', d('d')).artifact;
    const b = makeArtifact('typesafe-system-one/jev-1.13.0', d('0')).artifact;
    const qwen = makeArtifact('neo/qwen-ane', d('d')).artifact;
    expect(b.calibrationIdentity).not.toBe(a.calibrationIdentity);
    expect(qwen.calibrationIdentity).not.toBe(a.calibrationIdentity);
    expect(qwen.artifactDigest).not.toBe(a.artifactDigest);
  });

  it('rejects structural artifact copies', () => {
    const { artifact } = makeArtifact();
    expect(verifyProviderCalibrationArtifact({ ...artifact })).toBe(false);
  });
});
