import { describe, expect, it } from 'vitest';
import {
  EvidenceSufficiencyGateSweepCompilerV2,
  verifyEvidenceSufficiencyGateSweepArtifactV2,
} from '../src/lab/evidence-gate-sweep-v2.js';
import {
  CalibrationEvidenceCompilerV2,
} from '../src/lab/calibration-evidence-v2.js';
import {
  makeCalibrationCorpusV2,
  makeProviderProfileV2,
  d2,
} from './v2-calibration-fixtures.js';

function fixture() {
  const providerProfile = makeProviderProfileV2();
  const corpus = makeCalibrationCorpusV2(
    providerProfile.providerProfileDigest,
  );
  const build = new CalibrationEvidenceCompilerV2().compile({
    providerProfile,
    decisionContractDigest: d2('a'),
    compiledProgramDigest: d2('b'),
    samplingPolicyDigest: d2('c'),
    labelAuthorityPolicyDigest: d2('d'),
    labelBindingDigest: d2('e'),
    ...corpus,
    confidenceFloor: 0.8,
    eceBins: 5,
  });
  return { providerProfile, corpus, build };
}

describe('STRONG holdout evidence-sufficiency gate sweep V2', () => {
  it('derives a non-authoritative threshold sweep from the exact holdout artifact', () => {
    const { corpus, build } = fixture();
    const sweep = new EvidenceSufficiencyGateSweepCompilerV2().compile({
      build,
      holdoutLabels: corpus.holdoutLabels,
      holdoutPredictions: corpus.holdoutPredictions,
    });

    expect(sweep.schema)
      .toBe('anvil.evidence-sufficiency-gate-sweep.v2');
    expect(sweep.predicateId).toBe('evidence_sufficient');
    expect(sweep.providerProfileDigest).toBe(build.providerProfileDigest);
    expect(sweep.calibrationIdentity)
      .toBe(build.calibrationArtifact.calibrationIdentity);
    expect(sweep.holdoutMerkleRoot).toBe(build.holdoutMerkleRoot);
    expect(sweep.recommendationAuthority)
      .toBe('NON_AUTHORITATIVE_STRONG_HOLDOUT');
    expect(sweep.recommendationPolicy)
      .toBe('maximize-recall-subject-to-zero-observed-false-sufficient');
    expect(sweep.recommendedThreshold).not.toBeNull();
    expect(sweep.positiveCount).toBeGreaterThan(0);
    expect(sweep.negativeCount).toBeGreaterThan(0);
    expect(sweep.points.length).toBeGreaterThan(0);
    expect(verifyEvidenceSufficiencyGateSweepArtifactV2(sweep)).toBe(true);
  });

  it('never emits recoverability or authority credentials', () => {
    const { corpus, build } = fixture();
    const sweep = new EvidenceSufficiencyGateSweepCompilerV2().compile({
      build,
      holdoutLabels: corpus.holdoutLabels,
      holdoutPredictions: corpus.holdoutPredictions,
    });
    const serialized = JSON.stringify(sweep);
    expect(serialized).not.toMatch(/recoverable/i);
    expect(serialized)
      .not.toMatch(/authorityIdentity|credential|productionAuthorityGranted/);
  });

  it('rejects WEAK labels even when all other identities match', () => {
    const { corpus, build } = fixture();
    const labels = corpus.holdoutLabels.map((label, index) =>
      index === 0
        ? {
            ...label,
            authority: 'WEAK' as const,
            verifierIdentity: undefined,
          }
        : label);

    expect(() => new EvidenceSufficiencyGateSweepCompilerV2().compile({
      build,
      holdoutLabels: labels,
      holdoutPredictions: corpus.holdoutPredictions,
    })).toThrow(/STRONG/i);
  });

  it('rejects a holdout set that does not reproduce the build holdout root', () => {
    const { corpus, build } = fixture();
    const predictions = corpus.holdoutPredictions.map(
      (prediction, index) =>
        index === 0
          ? { ...prediction, probability: 0.77 }
          : prediction,
    );

    expect(() => new EvidenceSufficiencyGateSweepCompilerV2().compile({
      build,
      holdoutLabels: corpus.holdoutLabels,
      holdoutPredictions: predictions,
    })).toThrow(/holdout.*root|root.*holdout/i);
  });

  it('reports a finite 95% upper bound when the selected point has zero false-sufficient errors', () => {
    const { corpus, build } = fixture();
    const sweep = new EvidenceSufficiencyGateSweepCompilerV2().compile({
      build,
      holdoutLabels: corpus.holdoutLabels,
      holdoutPredictions: corpus.holdoutPredictions,
    });

    const recommended = sweep.points.find(
      (point) => point.threshold === sweep.recommendedThreshold,
    )!;
    expect(recommended.falseSufficient).toBe(0);
    expect(sweep.zeroFalseSufficientUpper95).not.toBeNull();
    expect(sweep.zeroFalseSufficientUpper95!).toBeGreaterThan(0);
    expect(sweep.zeroFalseSufficientUpper95!).toBeLessThanOrEqual(1);
  });

  it('rejects structural copies of the issued sweep artifact', () => {
    const { corpus, build } = fixture();
    const sweep = new EvidenceSufficiencyGateSweepCompilerV2().compile({
      build,
      holdoutLabels: corpus.holdoutLabels,
      holdoutPredictions: corpus.holdoutPredictions,
    });

    expect(
      verifyEvidenceSufficiencyGateSweepArtifactV2({ ...sweep }),
    ).toBe(false);
  });
});
