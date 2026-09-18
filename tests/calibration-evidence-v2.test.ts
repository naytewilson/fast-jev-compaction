import { describe, expect, it } from 'vitest';
import {
  CalibrationEvidenceCompilerV2,
  verifyProviderCalibrationBuildArtifactV2,
} from '../src/lab/calibration-evidence-v2.js';
import {
  MODELED_SEMANTIC_AXES_V2,
  SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
} from '../src/lab/semantic-contract-v2.js';
import {
  makeCalibrationCorpusV2,
  makeProviderProfileV2,
  d2,
} from './v2-calibration-fixtures.js';
import { deriveProviderExecutionProfile } from '../src/lab/provider-profile.js';

function input(providerId = 'typesafe-system-one/jev-1.13.0') {
  const providerProfile = makeProviderProfileV2(providerId);
  return {
    providerProfile,
    decisionContractDigest: d2('a'),
    compiledProgramDigest: d2('b'),
    samplingPolicyDigest: d2('c'),
    labelAuthorityPolicyDigest: d2('d'),
    labelBindingDigest: d2('e'),
    ...makeCalibrationCorpusV2(providerProfile.providerProfileDigest),
    confidenceFloor: 0.8,
    eceBins: 5,
  };
}

describe('Semantic Fabric V2 calibration evidence compiler', () => {
  it('fits exactly the four modeled predicates', () => {
    const build = new CalibrationEvidenceCompilerV2().compile(input());

    expect(build.schema).toBe('anvil.provider-calibration-build.v2');
    expect(build.calibrationArtifact.schema)
      .toBe('anvil.provider-calibration-artifact.v2');
    expect(build.calibrationArtifact.calibrators.map((x) => x.predicateId))
      .toEqual(MODELED_SEMANTIC_AXES_V2);
    expect(build.calibrationArtifact.calibrators).toHaveLength(4);
    expect(build.calibrationArtifact.providerProfile.observationABIDigest)
      .toBe(SEMANTIC_OBSERVATION_ABI_DIGEST_V2);
    expect(verifyProviderCalibrationBuildArtifactV2(build)).toBe(true);
  });

  it('rejects any attempt to calibrate semantic recoverability', () => {
    const bad = input();
    bad.trainingLabels.push({
      labelId: 'train-recoverable',
      authority: 'STRONG',
      decisionContractDigest: d2('a'),
      predicateId: 'recoverable' as any,
      labelBindingDigest: d2('e'),
      sourceDigest: d2('1'),
      outcomeDigest: d2('2'),
      target: 1,
      verifierIdentity: 'fixture-verifier',
    });
    bad.trainingPredictions.push({
      labelId: 'train-recoverable',
      predicateId: 'recoverable' as any,
      sourceDigest: d2('1'),
      executionProfileDigest: bad.providerProfile.providerProfileDigest,
      observationDigest: d2('3'),
      probability: 0.9,
    });

    expect(() => new CalibrationEvidenceCompilerV2().compile(bad as any))
      .toThrow(/recoverable|four modeled|predicate/i);
  });

  it('rejects a provider profile bound to the old five-axis ABI', () => {
    const bad = input();
    bad.providerProfile = deriveProviderExecutionProfile({
      providerId: bad.providerProfile.providerId,
      providerKind: bad.providerProfile.providerKind,
      modelIdentityDigest: bad.providerProfile.modelIdentityDigest,
      modelAssurance: bad.providerProfile.modelAssurance,
      executionSemanticsDigest: bad.providerProfile.executionSemanticsDigest,
      normalizerDigest: bad.providerProfile.normalizerDigest,
      observationABIDigest: d2('0'),
    });

    expect(() => new CalibrationEvidenceCompilerV2().compile(bad))
      .toThrow(/Observation ABI/i);
  });

  it('rejects WEAK labels and mixed provider namespaces', () => {
    const weak = input();
    weak.trainingLabels = weak.trainingLabels.map((x, index) =>
      index === 0
        ? { ...x, authority: 'WEAK' as const, verifierIdentity: undefined }
        : x);
    expect(() => new CalibrationEvidenceCompilerV2().compile(weak))
      .toThrow(/STRONG/i);

    const mixed = input();
    mixed.holdoutPredictions = mixed.holdoutPredictions.map((x, index) =>
      index === 0
        ? { ...x, executionProfileDigest: d2('0') }
        : x);
    expect(() => new CalibrationEvidenceCompilerV2().compile(mixed))
      .toThrow(/provider profile|execution profile/i);
  });

  it('rejects training or holdout missing any one modeled predicate', () => {
    const missingTrain = input();
    missingTrain.trainingLabels = missingTrain.trainingLabels.filter(
      (x) => x.predicateId !== 'unresolved_evidence',
    );
    missingTrain.trainingPredictions = missingTrain.trainingPredictions.filter(
      (x) => x.predicateId !== 'unresolved_evidence',
    );
    expect(() => new CalibrationEvidenceCompilerV2().compile(missingTrain))
      .toThrow(/four modeled|predicate/i);

    const missingHoldout = input();
    missingHoldout.holdoutLabels = missingHoldout.holdoutLabels.filter(
      (x) => x.predicateId !== 'evidence_sufficient',
    );
    missingHoldout.holdoutPredictions = missingHoldout.holdoutPredictions.filter(
      (x) => x.predicateId !== 'evidence_sufficient',
    );
    expect(() => new CalibrationEvidenceCompilerV2().compile(missingHoldout))
      .toThrow(/four modeled|predicate/i);
  });

  it('derives finite holdout metrics instead of accepting weak experiment metrics', () => {
    const build = new CalibrationEvidenceCompilerV2().compile(input());
    for (const value of [
      build.holdoutMetrics.ece,
      build.holdoutMetrics.brier,
      build.holdoutMetrics.nll,
      build.holdoutMetrics.selectiveRisk,
      build.holdoutMetrics.coverage,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});
