import { describe, expect, it } from 'vitest';
import {
  deriveCalibrationDatasetIdentity,
  selectAuthoritativeCalibrationLabels,
} from '../src/lab/calibration-data.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

const dataset = {
  trainingMerkleRoot: d('1'),
  holdoutMerkleRoot: d('2'),
  samplingPolicyDigest: d('3'),
  labelAuthorityPolicyDigest: d('4'),
  datasetGenerationDigest: d('5'),
};

describe('CalibrationDatasetIdentity', () => {
  it('changes when the training/holdout split changes', () => {
    const first = deriveCalibrationDatasetIdentity(dataset);
    const swapped = deriveCalibrationDatasetIdentity({
      ...dataset,
      trainingMerkleRoot: dataset.holdoutMerkleRoot,
      holdoutMerkleRoot: dataset.trainingMerkleRoot,
    });

    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(swapped).not.toBe(first);
  });
});

describe('calibration label authority', () => {
  it('selects only STRONG labels in deterministic id order', () => {
    const selected = selectAuthoritativeCalibrationLabels([
      {
        id: 'z',
        authority: 'STRONG',
        sourceDigest: d('6'),
        outcomeDigest: d('7'),
        verifierIdentity: 'deterministic:compiler',
      },
      {
        id: 'weak',
        authority: 'WEAK',
        sourceDigest: d('8'),
        outcomeDigest: d('9'),
      },
      {
        id: 'a',
        authority: 'STRONG',
        sourceDigest: d('a'),
        outcomeDigest: d('b'),
        verifierIdentity: 'counterfactual:exact',
      },
    ]);

    expect(selected.map((label) => label.id)).toEqual(['a', 'z']);
    expect(selected.every((label) => label.authority === 'STRONG')).toBe(true);
  });

  it('rejects duplicate label ids', () => {
    expect(() => selectAuthoritativeCalibrationLabels([
      {
        id: 'dup',
        authority: 'WEAK',
        sourceDigest: d('1'),
        outcomeDigest: d('2'),
      },
      {
        id: 'dup',
        authority: 'STRONG',
        sourceDigest: d('3'),
        outcomeDigest: d('4'),
        verifierIdentity: 'deterministic:test',
      },
    ])).toThrow(/duplicate label/i);
  });

  it('fails closed when STRONG evidence has no verifier identity', () => {
    expect(() => selectAuthoritativeCalibrationLabels([
      {
        id: 'strong',
        authority: 'STRONG',
        sourceDigest: d('1'),
        outcomeDigest: d('2'),
      },
    ])).toThrow(/verifier/i);
  });
});
