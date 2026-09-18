import { fitIsotonicCalibration } from '../src/lab/isotonic-calibrator.js';
import { MAPPED_OBSERVATION_AXES } from '../src/lab/types.js';
import { deriveProviderExecutionProfile } from '../src/lab/provider-profile.js';
import { ProviderCalibrationArtifactRegistry } from '../src/lab/calibration-artifact.js';
import { CalibrationEvidenceCompiler } from '../src/lab/calibration-evidence-compiler.js';
import { ProviderSafetyTrialRegistry } from '../src/lab/provider-safety-trial.js';
import { ArtifactPromotionEvidenceCompiler } from '../src/lab/promotion-evidence.js';
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

function label(
  providerProfileDigest: string,
  split: 'train' | 'holdout',
  predicateId: (typeof MAPPED_OBSERVATION_AXES)[number],
  target: 0 | 1,
  ordinal: number,
) {
  const labelId = `${split}:${predicateId}:${target}:${ordinal}`;
  return {
    label: {
      labelId,
      authority: 'STRONG' as const,
      decisionContractDigest: d('e'),
      predicateId,
      labelBindingDigest: d('5'),
      sourceDigest: target === 0 ? d('9') : d('a'),
      outcomeDigest: target === 0 ? d('b') : d('c'),
      target,
      verifierIdentity: 'fixture-verifier',
    },
    prediction: {
      labelId,
      sourceDigest: target === 0 ? d('9') : d('a'),
      predicateId,
      executionProfileDigest: providerProfileDigest,
      observationDigest: target === 0 ? d('d') : d('e'),
      probability: target === 0 ? 0.1 + ordinal * 0.001 : 0.9 - ordinal * 0.001,
    },
  };
}

export function makeCalibrationCorpus(providerProfileDigest: string) {
  const training: ReturnType<typeof label>[] = [];
  const holdout: ReturnType<typeof label>[] = [];
  MAPPED_OBSERVATION_AXES.forEach((predicateId, index) => {
    training.push(label(providerProfileDigest, 'train', predicateId, 0, index));
    training.push(label(providerProfileDigest, 'train', predicateId, 1, index));
    holdout.push(label(providerProfileDigest, 'holdout', predicateId, 0, index));
    holdout.push(label(providerProfileDigest, 'holdout', predicateId, 1, index));
  });
  return {
    trainingLabels: training.map((x) => x.label),
    trainingPredictions: training.map((x) => x.prediction),
    holdoutLabels: holdout.map((x) => x.label),
    holdoutPredictions: holdout.map((x) => x.prediction),
  };
}

export function makeBuild(providerId = 'typesafe-system-one/jev-1.13.0') {
  const providerProfile = makeProviderProfile(providerId);
  const corpus = makeCalibrationCorpus(providerProfile.providerProfileDigest);
  const build = new CalibrationEvidenceCompiler().compile({
    providerProfile,
    decisionContractDigest: d('e'),
    compiledProgramDigest: d('f'),
    samplingPolicyDigest: d('3'),
    labelAuthorityPolicyDigest: d('4'),
    labelBindingDigest: d('5'),
    ...corpus,
    confidenceFloor: 0.8,
    eceBins: 5,
  });
  return { providerProfile, corpus, build };
}

export function measuredSafetyCycles(count = 20) {
  return Array.from({ length: count }, (_, index) => ({
    scenario: index % 2 === 0 ? 'PARTIAL' as const : 'MODEL_BUMP' as const,
    shouldHavePolicyAuthority: false,
    policyTriggered: false,
    taskCompleted: true,
    fallbackActivated: true,
    detectMs: 0.2 + (index % 3) * 0.01,
    routeMs: 0.3 + (index % 4) * 0.01,
    firstUsefulResultMs: 2 + (index % 5) * 0.1,
    fallbackCompleteMs: 5 + (index % 7) * 0.1,
    syntheticTiming: false,
  }));
}

export function makeSafety(
  providerProfile = makeProviderProfile(),
  calibrationIdentity?: string,
) {
  const actualCalibrationIdentity =
    calibrationIdentity ?? makeBuild(providerProfile.providerId).build.calibrationArtifact.calibrationIdentity;
  return new ProviderSafetyTrialRegistry().register({
    providerProfile,
    calibrationIdentity: actualCalibrationIdentity,
    policyProfileDigest: d('6'),
    observationABIDigest: providerProfile.observationABIDigest,
    cycles: measuredSafetyCycles(),
  });
}

export function makeCompiledPromotionEvidence(providerId = 'typesafe-system-one/jev-1.13.0') {
  const { providerProfile, build } = makeBuild(providerId);
  const safety = makeSafety(providerProfile, build.calibrationArtifact.calibrationIdentity);
  const evidence = new ArtifactPromotionEvidenceCompiler().compile(build, safety);
  return { providerProfile, build, safety, evidence };
}

export function makePromotedArtifact(providerId = 'typesafe-system-one/jev-1.13.0') {
  const { providerProfile, build, safety, evidence } =
    makeCompiledPromotionEvidence(providerId);
  const promotedArtifact = new CalibrationArtifactPromotionRegistry().promote(
    build.calibrationArtifact,
    evidence,
    {
      minStrongHoldoutSamples: 5,
      maxFalseAuthorityLeaks: 0,
      maxECE: 0.1,
      maxBrier: 0.1,
      maxSelectiveRisk: 0.05,
      minCoverage: 0.8,
    },
  );
  return {
    providerProfile,
    artifact: build.calibrationArtifact,
    build,
    safety,
    evidence,
    promotedArtifact,
  };
}

export function makeCredential(
  providerId = 'typesafe-system-one/jev-1.13.0',
  authorityGeneration = 7,
) {
  const chain = makePromotedArtifact(providerId);
  const credential = new PromotionAuthorityIssuer().issue({
    providerProfile: chain.providerProfile,
    promotedArtifact: chain.promotedArtifact,
    policyProfileDigest: d('6'),
    observationABIDigest: chain.providerProfile.observationABIDigest,
    sourceLineageDigest: d('7'),
    authorityGeneration,
  });
  return { ...chain, credential };
}
