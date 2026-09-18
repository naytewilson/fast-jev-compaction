import { describe, expect, it } from 'vitest';
import {
  CalibrationEvidenceCompilerV2,
  verifyProviderCalibrationBuildArtifactV2,
} from '../src/lab/calibration-evidence-compiler-v2.js';
import {
  SEMANTIC_SENSOR_ABI_V2_DIGEST,
  SEMANTIC_SENSOR_AXES_V2,
} from '../src/lab/observation-abi-v2.js';
import { deriveProviderExecutionProfile } from '../src/lab/provider-profile.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

function profile() {
  return deriveProviderExecutionProfile({
    providerId: 'typesafe-system-one/jev-1.13.0',
    providerKind: 'jev-system-one',
    modelIdentityDigest: d('1'),
    modelAssurance: 'opaqueVersioned',
    executionSemanticsDigest: d('2'),
    normalizerDigest: d('3'),
    observationABIDigest: SEMANTIC_SENSOR_ABI_V2_DIGEST,
  });
}

function split(prefix: string, executionProfileDigest: string) {
  const labels: any[] = [];
  const predictions: any[] = [];
  for (const [index, predicateId] of SEMANTIC_SENSOR_AXES_V2.entries()) {
    for (const [suffix, target, probability] of [
      ['neg', 0, 0.1 + index * 0.01],
      ['pos', 1, 0.9 - index * 0.01],
    ] as const) {
      const labelId = `${prefix}-${predicateId}-${suffix}`;
      const sourceDigest = d((index + (target ? 5 : 1)).toString(16));
      labels.push({
        labelId,
        authority: 'STRONG',
        decisionContractDigest: d('8'),
        predicateId,
        labelBindingDigest: d('9'),
        sourceDigest,
        outcomeDigest: d('a'),
        target,
        verifierIdentity: 'deterministic-fixture-v2',
      });
      predictions.push({
        labelId,
        predicateId,
        sourceDigest,
        executionProfileDigest,
        observationDigest: d('b'),
        probability,
      });
    }
  }
  return { labels, predictions };
}

function input() {
  const p = profile();
  const training = split('train', p.providerProfileDigest);
  const holdout = split('holdout', p.providerProfileDigest);
  return {
    providerProfile: p,
    decisionContractDigest: d('8'),
    compiledProgramDigest: d('c'),
    samplingPolicyDigest: d('d'),
    labelAuthorityPolicyDigest: d('e'),
    labelBindingDigest: d('9'),
    trainingLabels: training.labels,
    trainingPredictions: training.predictions,
    holdoutLabels: holdout.labels,
    holdoutPredictions: holdout.predictions,
    confidenceFloor: 0.5,
    eceBins: 4,
  };
}

describe('CalibrationEvidenceCompilerV2', () => {
  it('builds a four-axis provider calibration artifact without recoverability', () => {
    const build = new CalibrationEvidenceCompilerV2().compile(input());
    expect(build.schema).toBe('anvil.provider-calibration-build.v2');
    expect(build.calibrationArtifact.calibrators).toHaveLength(4);
    expect(build.calibrationArtifact.calibrators.map((x) => x.predicateId))
      .toEqual([...SEMANTIC_SENSOR_AXES_V2]);
    expect(verifyProviderCalibrationBuildArtifactV2(build)).toBe(true);
  });

  it('rejects any recoverable label or prediction in the v2 calibration corpus', () => {
    const i = input();
    const extraLabel = {
      labelId: 'train-recoverable',
      authority: 'STRONG',
      decisionContractDigest: d('8'),
      predicateId: 'recoverable',
      labelBindingDigest: d('9'),
      sourceDigest: d('f'),
      outcomeDigest: d('a'),
      target: 1,
      verifierIdentity: 'deterministic-fixture-v2',
    };
    const extraPrediction = {
      labelId: 'train-recoverable',
      predicateId: 'recoverable',
      sourceDigest: d('f'),
      executionProfileDigest: i.providerProfile.providerProfileDigest,
      observationDigest: d('b'),
      probability: 0.9,
    };

    expect(() => new CalibrationEvidenceCompilerV2().compile({
      ...i,
      trainingLabels: [...i.trainingLabels, extraLabel as any],
      trainingPredictions: [...i.trainingPredictions, extraPrediction as any],
    })).toThrow(/recoverable|v2 predicate/i);
  });

  it('rejects a missing semantic predicate in either split', () => {
    const i = input();
    const trimmedLabels = i.holdoutLabels.filter(
      (x: any) => x.predicateId !== 'unresolved_evidence',
    );
    const trimmedPredictions = i.holdoutPredictions.filter(
      (x: any) => x.predicateId !== 'unresolved_evidence',
    );

    expect(() => new CalibrationEvidenceCompilerV2().compile({
      ...i,
      holdoutLabels: trimmedLabels,
      holdoutPredictions: trimmedPredictions,
    })).toThrow(/all four/i);
  });
});
