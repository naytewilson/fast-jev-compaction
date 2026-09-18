import { describe, expect, it } from 'vitest';
import {
  CalibrationEvidenceCompiler,
  verifyProviderCalibrationBuildArtifact,
} from '../src/lab/calibration-evidence-compiler.js';
import {
  makeBuild,
  makeCalibrationCorpus,
  makeProviderProfile,
  d,
} from './provider-authority-fixtures.js';

function input(providerId = 'typesafe-system-one/jev-1.13.0') {
  const providerProfile = makeProviderProfile(providerId);
  return {
    providerProfile,
    decisionContractDigest: d('e'),
    compiledProgramDigest: d('f'),
    samplingPolicyDigest: d('3'),
    labelAuthorityPolicyDigest: d('4'),
    labelBindingDigest: d('5'),
    ...makeCalibrationCorpus(providerProfile.providerProfileDigest),
    confidenceFloor: 0.8,
    eceBins: 5,
  };
}

describe('CalibrationEvidenceCompiler', () => {
  it('compiles a complete strong five-predicate corpus into a verified build artifact', () => {
    const { build } = makeBuild();
    expect(build.schema).toBe('anvil.provider-calibration-build.v1');
    expect(build.calibrationArtifact.calibrators).toHaveLength(5);
    expect(build.holdoutMetrics.sampleCount).toBe(10);
    expect(verifyProviderCalibrationBuildArtifact(build)).toBe(true);
  });

  it('rejects training or holdout missing a registered predicate', () => {
    const a = input();
    a.trainingLabels = a.trainingLabels.filter((x) => x.predicateId !== 'recoverable');
    a.trainingPredictions = a.trainingPredictions.filter((x) => x.predicateId !== 'recoverable');
    expect(() => new CalibrationEvidenceCompiler().compile(a)).toThrow(/five|predicate/i);

    const b = input();
    b.holdoutLabels = b.holdoutLabels.filter((x) => x.predicateId !== 'recoverable');
    b.holdoutPredictions = b.holdoutPredictions.filter((x) => x.predicateId !== 'recoverable');
    expect(() => new CalibrationEvidenceCompiler().compile(b)).toThrow(/five|predicate/i);
  });

  it('rejects WEAK labels and mixed provider predictions', () => {
    const weak = input();
    weak.trainingLabels = weak.trainingLabels.map((x, i) =>
      i === 0 ? { ...x, authority: 'WEAK' as const, verifierIdentity: undefined } : x);
    expect(() => new CalibrationEvidenceCompiler().compile(weak)).toThrow(/STRONG/i);

    const mixed = input();
    mixed.holdoutPredictions = mixed.holdoutPredictions.map((x, i) =>
      i === 0 ? { ...x, executionProfileDigest: d('0') } : x);
    expect(() => new CalibrationEvidenceCompiler().compile(mixed))
      .toThrow(/execution profile|provider profile/i);
  });

  it('changes build identity when one replay prediction changes', () => {
    const a = new CalibrationEvidenceCompiler().compile(input());
    const changed = input();
    changed.holdoutPredictions = changed.holdoutPredictions.map((x, i) =>
      i === 0 ? { ...x, probability: x.probability + 0.02 } : x);
    const b = new CalibrationEvidenceCompiler().compile(changed);
    expect(b.holdoutMerkleRoot).not.toBe(a.holdoutMerkleRoot);
    expect(b.buildDigest).not.toBe(a.buildDigest);
  });

  it('computes finite holdout metrics rather than accepting them from the caller', () => {
    const { build } = makeBuild();
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

  it('rejects structural build copies', () => {
    const { build } = makeBuild();
    expect(verifyProviderCalibrationBuildArtifact({ ...build })).toBe(false);
  });
});
