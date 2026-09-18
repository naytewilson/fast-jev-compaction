import { createHash } from 'node:crypto';

export type Digest256 = string;

export interface TaggedIdentityComponent {
  tag: number;
  data: Uint8Array;
}

export interface CalibrationIdentityInput {
  decisionContractDigest: Digest256;
  compiledProgramDigest: Digest256;
  executionSemanticsDigest: Digest256;
  modelIdentityDigest: Digest256;
  normalizerDigest: Digest256;
  trainingMerkleRoot: Digest256;
  holdoutMerkleRoot: Digest256;
  samplingPolicyDigest: Digest256;
  labelAuthorityPolicyDigest: Digest256;
  datasetGenerationDigest: Digest256;
  labelBindingDigest: Digest256;
  calibratorSpecDigest: Digest256;
  fittedParametersDigest: Digest256;
}

export interface AuthorityIdentityInput {
  calibrationIdentity: Digest256;
  policyProfileDigest: Digest256;
  observationABIDigest: Digest256;
}

const CANONICAL_SHA256 = /^sha256:[0-9a-f]{64}$/;

function digestBytes(value: Digest256): Uint8Array {
  if (!CANONICAL_SHA256.test(value)) {
    throw new TypeError('identity component must be canonical sha256');
  }
  return Buffer.from(value.slice('sha256:'.length), 'hex');
}

export function digestTaggedIdentity(
  domain: string,
  components: readonly TaggedIdentityComponent[],
): Digest256 {
  if (domain.length === 0 || domain.includes('\0')) {
    throw new TypeError('identity domain must be non-empty and NUL-free');
  }

  const stream: Buffer[] = [Buffer.from(domain + '\0', 'utf8')];
  let previousTag = 0;
  for (const component of components) {
    if (!Number.isInteger(component.tag) || component.tag < 1 || component.tag > 255) {
      throw new TypeError('identity tags must be integers in 1...255');
    }
    if (component.tag <= previousTag) {
      throw new TypeError('identity tags must be strictly increasing');
    }
    previousTag = component.tag;

    const bytes = Buffer.from(component.data);
    if (bytes.byteLength > 0xffff_ffff) {
      throw new RangeError('identity component exceeds uint32 framing');
    }
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.byteLength);
    stream.push(Buffer.from([component.tag]), length, bytes);
  }

  return 'sha256:' + createHash('sha256').update(Buffer.concat(stream)).digest('hex');
}

export function deriveCalibrationIdentity(input: CalibrationIdentityInput): Digest256 {
  const values = [
    input.decisionContractDigest,
    input.compiledProgramDigest,
    input.executionSemanticsDigest,
    input.modelIdentityDigest,
    input.normalizerDigest,
    input.trainingMerkleRoot,
    input.holdoutMerkleRoot,
    input.samplingPolicyDigest,
    input.labelAuthorityPolicyDigest,
    input.datasetGenerationDigest,
    input.labelBindingDigest,
    input.calibratorSpecDigest,
    input.fittedParametersDigest,
  ];

  return digestTaggedIdentity(
    'ANVIL.CalibrationIdentity.v2',
    values.map((value, index) => ({ tag: index + 1, data: digestBytes(value) })),
  );
}

export function deriveAuthorityIdentity(input: AuthorityIdentityInput): Digest256 {
  return digestTaggedIdentity('ANVIL.AuthorityIdentity.v2', [
    { tag: 1, data: digestBytes(input.calibrationIdentity) },
    { tag: 2, data: digestBytes(input.policyProfileDigest) },
    { tag: 3, data: digestBytes(input.observationABIDigest) },
  ]);
}
