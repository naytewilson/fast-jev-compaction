import {
  digestTaggedIdentity,
  type Digest256,
  type TaggedIdentityComponent,
} from './identity.js';

export type CalibrationLabelAuthority = 'STRONG' | 'WEAK';

export interface CalibrationEvidenceLabel {
  id: string;
  authority: CalibrationLabelAuthority;
  sourceDigest: Digest256;
  outcomeDigest: Digest256;
  verifierIdentity?: string;
}

export interface CalibrationDatasetIdentityInput {
  trainingMerkleRoot: Digest256;
  holdoutMerkleRoot: Digest256;
  samplingPolicyDigest: Digest256;
  labelAuthorityPolicyDigest: Digest256;
  datasetGenerationDigest: Digest256;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;

function digestBytes(value: Digest256, field: string): Uint8Array {
  if (!DIGEST.test(value)) throw new TypeError(`${field} must be canonical sha256`);
  return Buffer.from(value.slice('sha256:'.length), 'hex');
}

export function deriveCalibrationDatasetIdentity(
  input: CalibrationDatasetIdentityInput,
): Digest256 {
  const fields: Array<[number, string, Digest256]> = [
    [1, 'trainingMerkleRoot', input.trainingMerkleRoot],
    [2, 'holdoutMerkleRoot', input.holdoutMerkleRoot],
    [3, 'samplingPolicyDigest', input.samplingPolicyDigest],
    [4, 'labelAuthorityPolicyDigest', input.labelAuthorityPolicyDigest],
    [5, 'datasetGenerationDigest', input.datasetGenerationDigest],
  ];
  const components: TaggedIdentityComponent[] = fields.map(([tag, name, value]) => ({
    tag,
    data: digestBytes(value, name),
  }));
  return digestTaggedIdentity('ANVIL.CalibrationDatasetIdentity.v1', components);
}

export function selectAuthoritativeCalibrationLabels(
  labels: readonly CalibrationEvidenceLabel[],
): readonly Readonly<CalibrationEvidenceLabel>[] {
  const seen = new Set<string>();
  const strong: Readonly<CalibrationEvidenceLabel>[] = [];

  for (const label of labels) {
    if (label.id.length === 0) throw new TypeError('label id must be non-empty');
    if (seen.has(label.id)) throw new Error(`duplicate label id ${label.id}`);
    seen.add(label.id);

    digestBytes(label.sourceDigest, 'sourceDigest');
    digestBytes(label.outcomeDigest, 'outcomeDigest');

    if (label.authority === 'STRONG') {
      if (label.verifierIdentity === undefined || label.verifierIdentity.length === 0) {
        throw new Error(`STRONG label ${label.id} requires verifier identity`);
      }
      strong.push(Object.freeze({
        id: label.id,
        authority: 'STRONG',
        sourceDigest: label.sourceDigest,
        outcomeDigest: label.outcomeDigest,
        verifierIdentity: label.verifierIdentity,
      }));
    } else if (label.authority !== 'WEAK') {
      throw new TypeError('label authority must be STRONG or WEAK');
    }
  }

  strong.sort((a, b) => a.id.localeCompare(b.id));
  return Object.freeze(strong);
}
