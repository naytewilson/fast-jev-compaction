import { sha256Digest } from './recovery.js';
import {
  SEMANTIC_POLICY_SPEC_DIGEST_V2,
  validateObservationPolicyThresholdsV2,
  type ObservationPolicyThresholdsV2,
} from './semantic-policy-v2.js';

export interface SemanticPolicyProfileV2Input {
  id: string;
  version: string;
  thresholds: ObservationPolicyThresholdsV2;
}

export interface SemanticPolicyProfileV2 {
  schema: 'anvil.semantic-policy-profile.v2';
  id: string;
  version: string;
  policySemanticsDigest: string;
  thresholds: Readonly<ObservationPolicyThresholdsV2>;
  thresholdDigest: string;
  policyProfileDigest: string;
}

const KEYS = [
  'schema',
  'id',
  'version',
  'policySemanticsDigest',
  'thresholds',
  'thresholdDigest',
  'policyProfileDigest',
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length &&
    actual.every((key) => expected.includes(key));
}

function requireText(value: string, field: string): void {
  if (value.length === 0 || value.includes('\0')) {
    throw new TypeError(field + ' must be non-empty and NUL-free');
  }
}

function cloneThresholds(
  thresholds: ObservationPolicyThresholdsV2,
): Readonly<ObservationPolicyThresholdsV2> {
  validateObservationPolicyThresholdsV2(thresholds);
  return Object.freeze({
    evidenceSufficientFloor: thresholds.evidenceSufficientFloor,
    retain: thresholds.retain,
    keepFull: thresholds.keepFull,
    reviewFloor: thresholds.reviewFloor,
  });
}

function deriveCore(input: SemanticPolicyProfileV2Input) {
  requireText(input.id, 'policy profile id');
  requireText(input.version, 'policy profile version');
  const thresholds = cloneThresholds(input.thresholds);
  const thresholdDigest = sha256Digest(JSON.stringify({
    schema: 'anvil.semantic-policy-thresholds.v2',
    ...thresholds,
  }));
  const identityCore = {
    schema: 'anvil.semantic-policy-profile.v2' as const,
    id: input.id,
    version: input.version,
    policySemanticsDigest: SEMANTIC_POLICY_SPEC_DIGEST_V2,
    thresholdDigest,
  };
  return {
    ...identityCore,
    thresholds,
    policyProfileDigest: sha256Digest(JSON.stringify(identityCore)),
  };
}

export function deriveSemanticPolicyProfileV2(
  input: SemanticPolicyProfileV2Input,
): Readonly<SemanticPolicyProfileV2> {
  return Object.freeze(deriveCore(input));
}

export function verifySemanticPolicyProfileV2(
  value: unknown,
): value is SemanticPolicyProfileV2 {
  try {
    if (!isObject(value) || !exactKeys(value, KEYS)) return false;
    if (value.schema !== 'anvil.semantic-policy-profile.v2') return false;
    if (
      typeof value.id !== 'string' ||
      typeof value.version !== 'string' ||
      typeof value.policySemanticsDigest !== 'string' ||
      typeof value.thresholdDigest !== 'string' ||
      typeof value.policyProfileDigest !== 'string' ||
      !isObject(value.thresholds)
    ) return false;

    const expected = deriveCore({
      id: value.id,
      version: value.version,
      thresholds: value.thresholds as unknown as ObservationPolicyThresholdsV2,
    });
    return (
      value.policySemanticsDigest === expected.policySemanticsDigest &&
      value.thresholdDigest === expected.thresholdDigest &&
      value.policyProfileDigest === expected.policyProfileDigest &&
      JSON.stringify(value.thresholds) === JSON.stringify(expected.thresholds)
    );
  } catch {
    return false;
  }
}
