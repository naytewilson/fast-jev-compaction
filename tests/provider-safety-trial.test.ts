import { describe, expect, it } from 'vitest';
import {
  ProviderSafetyTrialRegistry,
  verifyProviderSafetyTrialArtifact,
} from '../src/lab/provider-safety-trial.js';
import {
  makeBuild,
  makeProviderProfile,
  measuredSafetyCycles,
  d,
} from './provider-authority-fixtures.js';

describe('ProviderSafetyTrialArtifact', () => {
  it('classifies measured no-leak safety evidence as MEASURED_SHADOW', () => {
    const { providerProfile, build } = makeBuild();
    const trial = new ProviderSafetyTrialRegistry().register({
      providerProfile,
      calibrationIdentity: build.calibrationArtifact.calibrationIdentity,
      policyProfileDigest: d('6'),
      observationABIDigest: providerProfile.observationABIDigest,
      cycles: measuredSafetyCycles(),
    });
    expect(trial.evidenceAuthority).toBe('MEASURED_SHADOW');
    expect(trial.result.falseAuthority.leaks).toBe(0);
    expect(trial.result.verdict).toBe('PASS_MEASURED');
    expect(verifyProviderSafetyTrialArtifact(trial)).toBe(true);
  });

  it('keeps synthetic safety evidence non-authoritative', () => {
    const { providerProfile, build } = makeBuild();
    const cycles = measuredSafetyCycles().map((cycle) => ({
      ...cycle,
      syntheticTiming: true,
    }));
    const trial = new ProviderSafetyTrialRegistry().register({
      providerProfile,
      calibrationIdentity: build.calibrationArtifact.calibrationIdentity,
      policyProfileDigest: d('6'),
      observationABIDigest: providerProfile.observationABIDigest,
      cycles,
    });
    expect(trial.evidenceAuthority).toBe('NON_AUTHORITATIVE');
    expect(trial.result.verdict).toBe('PASS_SYNTHETIC');
  });

  it('rejects provider ABI mismatch', () => {
    const { providerProfile, build } = makeBuild();
    expect(() => new ProviderSafetyTrialRegistry().register({
      providerProfile,
      calibrationIdentity: build.calibrationArtifact.calibrationIdentity,
      policyProfileDigest: d('6'),
      observationABIDigest: d('0'),
      cycles: measuredSafetyCycles(),
    })).toThrow(/ABI/i);
  });

  it('preserves false-authority leaks as architectural failure', () => {
    const { providerProfile, build } = makeBuild();
    const cycles = measuredSafetyCycles();
    cycles[0] = { ...cycles[0], policyTriggered: true };
    const trial = new ProviderSafetyTrialRegistry().register({
      providerProfile,
      calibrationIdentity: build.calibrationArtifact.calibrationIdentity,
      policyProfileDigest: d('6'),
      observationABIDigest: providerProfile.observationABIDigest,
      cycles,
    });
    expect(trial.result.falseAuthority.leaks).toBe(1);
    expect(trial.result.verdict).toBe('ARCHITECTURAL_FAILURE');
  });

  it('rejects structural copies', () => {
    const profile = makeProviderProfile();
    const build = makeBuild().build;
    const trial = new ProviderSafetyTrialRegistry().register({
      providerProfile: profile,
      calibrationIdentity: build.calibrationArtifact.calibrationIdentity,
      policyProfileDigest: d('6'),
      observationABIDigest: profile.observationABIDigest,
      cycles: measuredSafetyCycles(),
    });
    expect(verifyProviderSafetyTrialArtifact({ ...trial })).toBe(false);
  });
});
