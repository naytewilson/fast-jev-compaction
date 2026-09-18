import { describe, expect, it } from 'vitest';
import {
  ProviderCalibrationArtifactV2Registry,
  verifyProviderCalibrationArtifactV2,
} from '../src/lab/calibration-artifact-v2.js';
import {
  SEMANTIC_SENSOR_ABI_V2_DIGEST,
  SEMANTIC_SENSOR_AXES_V2,
} from '../src/lab/observation-abi-v2.js';
import { deriveProviderExecutionProfile } from '../src/lab/provider-profile.js';
import { fitIsotonicCalibration } from '../src/lab/isotonic-calibrator.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

function profile(abi = SEMANTIC_SENSOR_ABI_V2_DIGEST) {
  return deriveProviderExecutionProfile({
    providerId: 'typesafe-system-one/jev-1.13.0',
    providerKind: 'jev-system-one',
    modelIdentityDigest: d('1'),
    modelAssurance: 'opaqueVersioned',
    executionSemanticsDigest: d('2'),
    normalizerDigest: d('3'),
    observationABIDigest: abi,
  });
}

function calibrators(executionProfileDigest: string) {
  return SEMANTIC_SENSOR_AXES_V2.map((predicateId, index) =>
    fitIsotonicCalibration([
      {
        labelId: `${predicateId}-0`,
        sourceDigest: d('4'),
        predicateId,
        executionProfileDigest,
        observationDigest: d('5'),
        probability: 0.1 + index * 0.01,
        target: 0,
      },
      {
        labelId: `${predicateId}-1`,
        sourceDigest: d('6'),
        predicateId,
        executionProfileDigest,
        observationDigest: d('7'),
        probability: 0.9 - index * 0.01,
        target: 1,
      },
    ]),
  );
}

function input(p = profile()) {
  return {
    providerProfile: p,
    decisionContractDigest: d('8'),
    compiledProgramDigest: d('9'),
    dataset: {
      trainingMerkleRoot: d('a'),
      holdoutMerkleRoot: d('b'),
      samplingPolicyDigest: d('c'),
      labelAuthorityPolicyDigest: d('d'),
      datasetGenerationDigest: d('e'),
    },
    labelBindingDigest: d('f'),
    calibrators: calibrators(p.providerProfileDigest),
  };
}

describe('ProviderCalibrationArtifactV2', () => {
  it('registers exactly four semantic calibrators under the v2 Observation ABI', () => {
    const artifact = new ProviderCalibrationArtifactV2Registry().register(input());
    expect(artifact.schema).toBe('anvil.provider-calibration-artifact.v2');
    expect(artifact.calibrators.map((x) => x.predicateId))
      .toEqual([...SEMANTIC_SENSOR_AXES_V2]);
    expect(verifyProviderCalibrationArtifactV2(artifact)).toBe(true);
  });

  it('rejects recoverable as a modeled calibrator', () => {
    const p = profile();
    const extra = fitIsotonicCalibration([
      {
        labelId: 'recoverable-0',
        sourceDigest: d('4'),
        predicateId: 'recoverable',
        executionProfileDigest: p.providerProfileDigest,
        observationDigest: d('5'),
        probability: 0.1,
        target: 0,
      },
      {
        labelId: 'recoverable-1',
        sourceDigest: d('6'),
        predicateId: 'recoverable',
        executionProfileDigest: p.providerProfileDigest,
        observationDigest: d('7'),
        probability: 0.9,
        target: 1,
      },
    ]);

    expect(() => new ProviderCalibrationArtifactV2Registry().register({
      ...input(p),
      calibrators: [...calibrators(p.providerProfileDigest), extra],
    })).toThrow(/four|recoverable|predicate/i);
  });

  it('rejects provider profiles bound to a different Observation ABI', () => {
    const p = profile(d('0'));
    expect(() => new ProviderCalibrationArtifactV2Registry().register(input(p)))
      .toThrow(/Observation ABI/i);
  });

  it('rejects structural artifact copies', () => {
    const artifact = new ProviderCalibrationArtifactV2Registry().register(input());
    expect(verifyProviderCalibrationArtifactV2({ ...artifact })).toBe(false);
  });
});
