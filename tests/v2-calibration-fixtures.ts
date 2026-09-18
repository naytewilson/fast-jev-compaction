import {
  MODELED_SEMANTIC_AXES_V2,
  SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
  type ModeledSemanticAxisV2,
} from '../src/lab/semantic-contract-v2.js';
import { deriveProviderExecutionProfile } from '../src/lab/provider-profile.js';
import type { SemanticCalibrationLabelV2 } from '../src/lab/semantic-label-v2.js';
import type { SemanticReplayPredictionV2 } from '../src/lab/calibration-replay-v2.js';

export const d2 = (c: string) => 'sha256:' + c.repeat(64);

export function makeProviderProfileV2(
  providerId = 'typesafe-system-one/jev-1.13.0',
) {
  return deriveProviderExecutionProfile({
    providerId,
    providerKind: providerId.includes('qwen') ? 'qwen-ane' : 'jev-system-one',
    modelIdentityDigest: providerId.includes('qwen') ? d2('2') : d2('1'),
    modelAssurance: providerId.includes('qwen')
      ? 'contentVerified'
      : 'opaqueVersioned',
    executionSemanticsDigest: providerId.includes('qwen') ? d2('4') : d2('3'),
    normalizerDigest: d2('5'),
    observationABIDigest: SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
  });
}

function label(
  id: string,
  predicateId: ModeledSemanticAxisV2,
  sourceDigest: string,
  target: 0 | 1,
): SemanticCalibrationLabelV2 {
  return {
    labelId: id,
    authority: 'STRONG',
    decisionContractDigest: d2('a'),
    predicateId,
    labelBindingDigest: d2('b'),
    sourceDigest,
    outcomeDigest: d2(target === 1 ? 'c' : 'd'),
    target,
    verifierIdentity: 'fixture-verifier',
  };
}

function prediction(
  label: SemanticCalibrationLabelV2,
  providerProfileDigest: string,
  probability: number,
): SemanticReplayPredictionV2 {
  return {
    labelId: label.labelId,
    predicateId: label.predicateId,
    sourceDigest: label.sourceDigest,
    executionProfileDigest: providerProfileDigest,
    observationDigest: d2(probability > 0.5 ? 'e' : 'f'),
    probability,
  };
}

export function makeCalibrationCorpusV2(providerProfileDigest: string) {
  const trainingLabels: SemanticCalibrationLabelV2[] = [];
  const trainingPredictions: SemanticReplayPredictionV2[] = [];
  const holdoutLabels: SemanticCalibrationLabelV2[] = [];
  const holdoutPredictions: SemanticReplayPredictionV2[] = [];

  MODELED_SEMANTIC_AXES_V2.forEach((predicateId, index) => {
    const train0 = label(
      `train-${predicateId}-0`,
      predicateId,
      d2(String((index + 1) % 10)),
      0,
    );
    const train1 = label(
      `train-${predicateId}-1`,
      predicateId,
      d2(String((index + 5) % 10)),
      1,
    );
    const hold0 = label(
      `hold-${predicateId}-0`,
      predicateId,
      d2(String((index + 2) % 10)),
      0,
    );
    const hold1 = label(
      `hold-${predicateId}-1`,
      predicateId,
      d2(String((index + 6) % 10)),
      1,
    );

    trainingLabels.push(train0, train1);
    trainingPredictions.push(
      prediction(train0, providerProfileDigest, 0.1 + index * 0.01),
      prediction(train1, providerProfileDigest, 0.9 - index * 0.01),
    );
    holdoutLabels.push(hold0, hold1);
    holdoutPredictions.push(
      prediction(hold0, providerProfileDigest, 0.15 + index * 0.01),
      prediction(hold1, providerProfileDigest, 0.85 - index * 0.01),
    );
  });

  return {
    trainingLabels,
    trainingPredictions,
    holdoutLabels,
    holdoutPredictions,
  };
}
