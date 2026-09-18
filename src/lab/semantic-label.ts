import type { Digest256 } from './identity.js';
import type { MappedObservationAxis } from './types.js';

export type SemanticLabelAuthority = 'STRONG' | 'WEAK';

export interface SemanticCalibrationLabel {
  labelId: string;
  authority: SemanticLabelAuthority;
  decisionContractDigest: Digest256;
  predicateId: MappedObservationAxis;
  labelBindingDigest: Digest256;
  sourceDigest: Digest256;
  outcomeDigest: Digest256;
  target: 0 | 1;
  verifierIdentity?: string;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const PREDICATES = new Set<MappedObservationAxis>([
  'evidence_sufficient',
  'still_needed',
  'full_content_needed',
  'unresolved_evidence',
]);

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) {
    throw new TypeError(`${field} must be canonical sha256`);
  }
}

export function validateSemanticCalibrationLabel(
  label: SemanticCalibrationLabel,
): true {
  if (label.labelId.length === 0) {
    throw new TypeError('semantic label id must be non-empty');
  }
  if (label.authority !== 'STRONG' && label.authority !== 'WEAK') {
    throw new TypeError('semantic label authority must be STRONG or WEAK');
  }
  requireDigest(label.decisionContractDigest, 'decisionContractDigest');
  requireDigest(label.labelBindingDigest, 'labelBindingDigest');
  requireDigest(label.sourceDigest, 'sourceDigest');
  requireDigest(label.outcomeDigest, 'outcomeDigest');
  if (!PREDICATES.has(label.predicateId)) {
    throw new TypeError('semantic label predicate is not registered');
  }
  if (label.target !== 0 && label.target !== 1) {
    throw new TypeError('semantic label target must be 0 or 1');
  }
  if (
    label.authority === 'STRONG' &&
    (label.verifierIdentity === undefined || label.verifierIdentity.length === 0)
  ) {
    throw new Error('STRONG semantic label requires verifier identity');
  }
  return true;
}

function freezeLabel(
  label: SemanticCalibrationLabel,
): Readonly<SemanticCalibrationLabel> {
  validateSemanticCalibrationLabel(label);
  return Object.freeze({
    labelId: label.labelId,
    authority: label.authority,
    decisionContractDigest: label.decisionContractDigest,
    predicateId: label.predicateId,
    labelBindingDigest: label.labelBindingDigest,
    sourceDigest: label.sourceDigest,
    outcomeDigest: label.outcomeDigest,
    target: label.target,
    ...(label.verifierIdentity !== undefined
      ? { verifierIdentity: label.verifierIdentity }
      : {}),
  });
}

export function selectAuthoritativeSemanticLabels(
  labels: readonly SemanticCalibrationLabel[],
): readonly Readonly<SemanticCalibrationLabel>[] {
  const seen = new Set<string>();
  const authoritative: Readonly<SemanticCalibrationLabel>[] = [];

  for (const label of labels) {
    validateSemanticCalibrationLabel(label);
    if (seen.has(label.labelId)) {
      throw new Error(`duplicate label id ${label.labelId}`);
    }
    seen.add(label.labelId);
    if (label.authority === 'STRONG') {
      authoritative.push(freezeLabel(label));
    }
  }

  authoritative.sort((a, b) => a.labelId.localeCompare(b.labelId));
  return Object.freeze(authoritative);
}

export function freezeSemanticCalibrationLabel(
  label: SemanticCalibrationLabel,
): Readonly<SemanticCalibrationLabel> {
  return freezeLabel(label);
}
