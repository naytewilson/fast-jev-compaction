import { describe, expect, it } from 'vitest';
import {
  ArtifactPromotionEvidenceCompilerV2,
  verifyCompiledArtifactPromotionEvidenceV2,
} from '../src/lab/promotion-evidence-v2.js';
import {
  CalibrationArtifactPromotionRegistryV2,
  verifyPromotedCalibrationArtifactV3,
} from '../src/lab/calibration-artifact-promotion-v2.js';
import {
  PromotionAuthorityIssuerV3,
  verifyPromotedAuthorityCredentialV3,
} from '../src/lab/promotion-credential-v3.js';
import {
  CalibrationEvidenceCompilerV2,
} from '../src/lab/calibration-evidence-v2.js';
import { ProviderSafetyTrialRegistry } from '../src/lab/provider-safety-trial.js';
import { AuthorityRegistry } from '../src/lab/authority-registry.js';
import {
  selectAuthorityRoute,
  type AuthorityRoutingRequest,
} from '../src/lab/authority-router.js';
import {
  SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
} from '../src/lab/semantic-contract-v2.js';
import {
  makeCalibrationCorpusV2,
  makeProviderProfileV2,
  d2,
} from './v2-calibration-fixtures.js';
import { measuredSafetyCycles } from './provider-authority-fixtures.js';

const promotionPolicy = {
  minStrongHoldoutSamples: 5,
  maxFalseAuthorityLeaks: 0,
  maxECE: 0.1,
  maxBrier: 0.1,
  maxSelectiveRisk: 0.05,
  minCoverage: 0.8,
};

function build(providerId = 'typesafe-system-one/jev-1.13.0') {
  const providerProfile = makeProviderProfileV2(providerId);
  const calibrationBuild = new CalibrationEvidenceCompilerV2().compile({
    providerProfile,
    decisionContractDigest: d2('a'),
    compiledProgramDigest: d2('b'),
    samplingPolicyDigest: d2('c'),
    labelAuthorityPolicyDigest: d2('d'),
    labelBindingDigest: d2('e'),
    ...makeCalibrationCorpusV2(providerProfile.providerProfileDigest),
    confidenceFloor: 0.8,
    eceBins: 5,
  });
  return { providerProfile, calibrationBuild };
}

function chain(providerId = 'typesafe-system-one/jev-1.13.0') {
  const { providerProfile, calibrationBuild } = build(providerId);
  const safety = new ProviderSafetyTrialRegistry().register({
    providerProfile,
    calibrationIdentity:
      calibrationBuild.calibrationArtifact.calibrationIdentity,
    policyProfileDigest: d2('6'),
    observationABIDigest: SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
    cycles: measuredSafetyCycles(),
  });
  const evidence = new ArtifactPromotionEvidenceCompilerV2().compile(
    calibrationBuild,
    safety,
  );
  const promoted = new CalibrationArtifactPromotionRegistryV2().promote(
    calibrationBuild.calibrationArtifact,
    evidence,
    promotionPolicy,
  );
  const credential = new PromotionAuthorityIssuerV3().issue({
    providerProfile,
    promotedArtifact: promoted,
    policyProfileDigest: d2('6'),
    observationABIDigest: SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
    sourceLineageDigest: d2('7'),
    authorityGeneration: 11,
  });
  return {
    providerProfile,
    calibrationBuild,
    safety,
    evidence,
    promoted,
    credential,
  };
}

describe('four-axis semantic authority chain', () => {
  it('compiles measured V2 calibration + safety into issued promotion evidence', () => {
    const { calibrationBuild, safety, evidence } = chain();
    expect(evidence.schema)
      .toBe('anvil.compiled-artifact-promotion-evidence.v2');
    expect(evidence.artifactDigest)
      .toBe(calibrationBuild.calibrationArtifact.artifactDigest);
    expect(evidence.safetyTrialDigest).toBe(safety.trialDigest);
    expect(evidence.observationABIDigest)
      .toBe(SEMANTIC_OBSERVATION_ABI_DIGEST_V2);
    expect(verifyCompiledArtifactPromotionEvidenceV2(evidence)).toBe(true);
  });

  it('promotes a V2 calibration artifact without reintroducing a fifth semantic axis', () => {
    const { promoted, calibrationBuild } = chain();
    expect(promoted.schema).toBe('anvil.promoted-calibration-artifact.v3');
    expect(promoted.calibrationIdentity)
      .toBe(calibrationBuild.calibrationArtifact.calibrationIdentity);
    expect(promoted.observationABIDigest)
      .toBe(SEMANTIC_OBSERVATION_ABI_DIGEST_V2);
    expect(verifyPromotedCalibrationArtifactV3(promoted)).toBe(true);
    expect(JSON.stringify(promoted)).not.toMatch(/recoverable/i);
  });

  it('mints a provider-bound V3 credential only from the issued V2 promotion artifact', () => {
    const { credential, promoted } = chain();
    expect(credential.schema).toBe('anvil.promoted-authority-credential.v3');
    expect(credential.promotedArtifactDigest)
      .toBe(promoted.promotedArtifactDigest);
    expect(credential.observationABIDigest)
      .toBe(SEMANTIC_OBSERVATION_ABI_DIGEST_V2);
    expect(verifyPromotedAuthorityCredentialV3(credential)).toBe(true);
  });

  it('registers V3 credentials without weakening legacy credential validation', () => {
    const { credential } = chain();
    const registry = new AuthorityRegistry();
    const grant = registry.registerCredential(credential);
    expect(grant.providerProfileDigest).toBe(credential.providerProfileDigest);
    expect(grant.observationABIDigest).toBe(SEMANTIC_OBSERVATION_ABI_DIGEST_V2);
    expect(registry.resolve(grant.routeId, d2('7'))).toBe(grant);
  });

  it('does not let a valid semantic credential bypass an evidence deficit', () => {
    const { credential } = chain();
    const registry = new AuthorityRegistry();
    const grant = registry.registerCredential(credential);

    const request: AuthorityRoutingRequest = {
      requestId: 'req-v2-authority',
      sourceLineageDigest: d2('7'),
      routeGeneration: 11,
      primaryRouteId: grant.routeId,
      evidenceDeficit: true,
      mechanicalRecoveryAvailable: true,
      pristineAvailable: true,
      compatibleProfileRouteIds: [],
      alternateProviderRouteIds: [],
    };

    const decision = selectAuthorityRoute(request, registry);
    expect(decision.route).toBe('hydrate');
    expect(decision.effectiveAuthorityIdentity).toBeNull();
  });

  it('rejects cross-provider promoted artifacts and structural credential copies', () => {
    const jev = chain();
    const qwen = build('neo/qwen-ane');

    expect(() => new PromotionAuthorityIssuerV3().issue({
      providerProfile: qwen.providerProfile,
      promotedArtifact: jev.promoted,
      policyProfileDigest: d2('6'),
      observationABIDigest: SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
      sourceLineageDigest: d2('7'),
      authorityGeneration: 11,
    })).toThrow(/provider profile/i);

    expect(verifyPromotedAuthorityCredentialV3({ ...jev.credential }))
      .toBe(false);
  });

  it('rejects synthetic safety evidence before promotion evidence exists', () => {
    const { providerProfile, calibrationBuild } = build();
    const safety = new ProviderSafetyTrialRegistry().register({
      providerProfile,
      calibrationIdentity:
        calibrationBuild.calibrationArtifact.calibrationIdentity,
      policyProfileDigest: d2('6'),
      observationABIDigest: SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
      cycles: measuredSafetyCycles().map((cycle) => ({
        ...cycle,
        syntheticTiming: true,
      })),
    });

    expect(() => new ArtifactPromotionEvidenceCompilerV2().compile(
      calibrationBuild,
      safety,
    )).toThrow(/MEASURED_SHADOW|authoritative/i);
  });
});
