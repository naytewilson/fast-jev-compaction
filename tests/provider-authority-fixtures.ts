import { fitIsotonicCalibration } from '../src/lab/isotonic-calibrator.js';
import { MAPPED_OBSERVATION_AXES } from '../src/lab/types.js';
import { deriveProviderExecutionProfile } from '../src/lab/provider-profile.js';
import { ProviderCalibrationArtifactRegistry } from '../src/lab/calibration-artifact.js';
import { CalibrationArtifactPromotionRegistry } from '../src/lab/calibration-artifact-promotion.js';
import { PromotionAuthorityIssuer } from '../src/lab/promotion-credential.js';

export const d = (c: string) => 'sha256:' + c.repeat(64);

export function makeProviderProfile(providerId = 'typesafe-system-one/jev-1.13.0') {
  return deriveProviderExecutionProfile({
    providerId,
    providerKind: providerId.includes('qwen')
      ? 'qwen-ane'
      : providerId.includes('mavis')
        ? 'mavis'
        : 'jev-system-one',
    modelIdentityDigest: providerId.includes('qwen') ? d('2') : providerId.includes('mavis') ? d('3') : d('1'),
    modelAssurance: providerId.includes('qwen') ? 'contentVerified' : 'opaqueVersioned',
    executionSemanticsDigest: providerId.includes('qwen') ? d('5') : providerId.includes('mavis') ? d('6') : d('4'),
    normalizerDigest: d('7'),
    observationABIDigest: d('8'),
  });
}

export function makeCalibrators(providerProfileDigest: string) {
  return MAPPED_OBSERVATION_AXES.map((predicateId, index) =>
    fitIsotonicCalibration([
      {
        labelId: `${predicateId}-low`,
        sourceDigest: d('9'),
        predicateId,
        executionProfileDigest: providerProfileDigest,
        observationDigest: d('a'),
        probability: 0.1 + index * 0.001,
        target: 0 as const,
      },
      {
        labelId: `${predicateId}-high`,
        sourceDigest: d('b'),
        predicateId,
        executionProfileDigest: providerProfileDigest,
        observationDigest: d('c'),
        probability: 0.9 - index * 0.001,
        target: 1 as const,
      },
    ]),
  );
}

export function makeArtifact(
  providerId = 'typesafe-system-one/jev-1.13.0',
  datasetGenerationDigest = d('d'),
) {
  const providerProfile = makeProviderProfile(providerId);
  const artifact = new ProviderCalibrationArtifactRegistry().register({
    providerProfile,
    decisionContractDigest: d('e'),
    compiledProgramDigest: d('f'),
    dataset: {
      trainingMerkleRoot: d('1'),
      holdoutMerkleRoot: d('2'),
      samplingPolicyDigest: d('3'),
      labelAuthorityPolicyDigest: d('4'),
      datasetGenerationDigest,
    },
    labelBindingDigest: d('5'),
    calibrators: makeCalibrators(providerProfile.providerProfileDigest),
  });
  return { providerProfile, artifact };
}

export function makePromotedArtifact(providerId = 'typesafe-system-one/jev-1.13.0') {
  const { providerProfile, artifact } = makeArtifact(providerId);
  const promotedArtifact = new CalibrationArtifactPromotionRegistry().promote(
    artifact,
    {
      strongHoldoutSamples: 500,
      falseAuthorityLeaks: 0,
      ece: 0.02,
      brier: 0.04,
      selectiveRisk: 0.01,
      coverage: 0.9,
    },
    {
      minStrongHoldoutSamples: 100,
      maxFalseAuthorityLeaks: 0,
      maxECE: 0.05,
      maxBrier: 0.1,
      maxSelectiveRisk: 0.02,
      minCoverage: 0.8,
    },
  );
  return { providerProfile, artifact, promotedArtifact };
}

export function makeCredential(
  providerId = 'typesafe-system-one/jev-1.13.0',
  authorityGeneration = 7,
) {
  const { providerProfile, artifact, promotedArtifact } = makePromotedArtifact(providerId);
  const credential = new PromotionAuthorityIssuer().issue({
    providerProfile,
    promotedArtifact,
    policyProfileDigest: d('6'),
    observationABIDigest: providerProfile.observationABIDigest,
    sourceLineageDigest: d('7'),
    authorityGeneration,
  });
  return { providerProfile, artifact, promotedArtifact, credential };
}
