import { describe, expect, it } from 'vitest';
import {
  ArtifactPromotionEvidenceCompiler,
  verifyCompiledArtifactPromotionEvidence,
} from '../src/lab/promotion-evidence.js';
import {
  makeBuild,
  makeCompiledPromotionEvidence,
  makeProviderProfile,
  measuredSafetyCycles,
  d,
} from './provider-authority-fixtures.js';
import { ProviderSafetyTrialRegistry } from '../src/lab/provider-safety-trial.js';

describe('CompiledArtifactPromotionEvidence', () => {
  it('compiles matching measured calibration and safety artifacts', () => {
    const { build, safety, evidence } = makeCompiledPromotionEvidence();
    expect(evidence.artifactDigest).toBe(build.calibrationArtifact.artifactDigest);
    expect(evidence.safetyTrialDigest).toBe(safety.trialDigest);
    expect(evidence.falseAuthorityLeaks).toBe(0);
    expect(verifyCompiledArtifactPromotionEvidence(evidence)).toBe(true);
  });

  it('rejects synthetic safety evidence', () => {
    const { providerProfile, build } = makeBuild();
    const safety = new ProviderSafetyTrialRegistry().register({
      providerProfile,
      calibrationIdentity: build.calibrationArtifact.calibrationIdentity,
      policyProfileDigest: d('6'),
      observationABIDigest: providerProfile.observationABIDigest,
      cycles: measuredSafetyCycles().map((cycle) => ({ ...cycle, syntheticTiming: true })),
    });
    expect(() => new ArtifactPromotionEvidenceCompiler().compile(build, safety))
      .toThrow(/MEASURED_SHADOW|authoritative/i);
  });

  it('rejects cross-provider calibration and safety evidence', () => {
    const jev = makeBuild();
    const qwen = makeBuild('neo/qwen-ane');
    const safety = new ProviderSafetyTrialRegistry().register({
      providerProfile: makeProviderProfile('neo/qwen-ane'),
      calibrationIdentity: qwen.build.calibrationArtifact.calibrationIdentity,
      policyProfileDigest: d('6'),
      observationABIDigest: qwen.providerProfile.observationABIDigest,
      cycles: measuredSafetyCycles(),
    });
    expect(() => new ArtifactPromotionEvidenceCompiler().compile(jev.build, safety))
      .toThrow(/provider|calibration/i);
  });

  it('rejects structural copies', () => {
    const { evidence } = makeCompiledPromotionEvidence();
    expect(verifyCompiledArtifactPromotionEvidence({ ...evidence })).toBe(false);
  });
});
