import type { Digest256 } from './identity.js';
import {
  MODELED_SEMANTIC_AXES_V2,
  type ModeledSemanticAxisV2,
} from './semantic-contract-v2.js';
import type { SemanticLabelAuthority } from './semantic-label.js';

export interface SemanticCalibrationLabelV2 {
  labelId: string;
  authority: SemanticLabelAuthority;
  decisionContractDigest: Digest256;
  predicateId: ModeledSemanticAxisV2;
  labelBindingDigest: Digest256;
  sourceDigest: Digest256;
  outcomeDigest: Digest256;
  target: 0 | 1;
  verifierIdentity?: string;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) {
    throw new TypeError(`${field} must be canonical sha256`);
  }
}

export function validateSemanticCalibrationLabelV2(
  label: SemanticCalibrationLabelV2,
): true {
  if (label.labelId.length === 0) {
    throw new TypeError('semantic v2 label id must be non-empty');
  }
  if (label.authority !== 'STRONG' && label.authority !== 'WEAK') {
    throw new TypeError('semantic v2 label authority must be STRONG or WEAK');
  }
  requireDigest(label.decisionContractDigest, 'decisionContractDigest');
  requireDigest(label.labelBindingDigest, 'labelBindingDigest');
  requireDigest(label.sourceDigest, 'sourceDigest');
  requireDigest(label.outcomeDigest, 'outcomeDigest');
  if (!MODELED_SEMANTIC_AXES_V2.includes(label.predicateId)) {
    throw new TypeError(
      'semantic v2 label predicate must be one of the four modeled predicates; recoverable is mechanical-only',
    );
  }
  if (label.target !== 0 && label.target !== 1) {
    throw new TypeError('semantic v2 label target must be 0 or 1');
  }
  if (
    label.authority === 'STRONG' &&
    (label.verifierIdentity === undefined || label.verifierIdentity.length === 0)
  ) {
    throw new Error('STRONG semantic v2 label requires verifier identity');
  }
  return true;
}

function freezeLabel(
  label: SemanticCalibrationLabelV2,
): Readonly<SemanticCalibrationLabelV2> {
  validateSemanticCalibrationLabelV2(label);
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

export function selectAuthoritativeSemanticLabelsV2(
  labels: readonly SemanticCalibrationLabelV2[],
): readonly Readonly<SemanticCalibrationLabelV2>[] {
  const seen = new Set<string>();
  const authoritative: Readonly<SemanticCalibrationLabelV2>[] = [];
  for (const label of labels) {
    validateSemanticCalibrationLabelV2(label);
    if (seen.has(label.labelId)) {
      throw new Error(`duplicate semantic v2 label id ${label.labelId}`);
    }
    seen.add(label.labelId);
    if (label.authority === 'STRONG') {
      authoritative.push(freezeLabel(label));
    }
  }
  authoritative.sort((a, b) => a.labelId.localeCompare(b.labelId));
  return Object.freeze(authoritative);
}
