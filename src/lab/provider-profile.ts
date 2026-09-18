import {
  digestTaggedIdentity,
  type Digest256,
  type TaggedIdentityComponent,
} from './identity.js';

export type SemanticProviderKind =
  | 'jev-system-one'
  | 'mavis'
  | 'qwen-ane'
  | 'custom';

export type ProviderModelAssurance =
  | 'contentVerified'
  | 'providerAttested'
  | 'opaqueVersioned'
  | 'unknown';

export interface ProviderExecutionProfileInput {
  providerId: string;
  providerKind: SemanticProviderKind;
  modelIdentityDigest: Digest256;
  modelAssurance: ProviderModelAssurance;
  executionSemanticsDigest: Digest256;
  normalizerDigest: Digest256;
  observationABIDigest: Digest256;
}

export interface ProviderExecutionProfile extends ProviderExecutionProfileInput {
  schema: 'anvil.provider-execution-profile.v1';
  providerProfileDigest: Digest256;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const KINDS = new Set<SemanticProviderKind>([
  'jev-system-one',
  'mavis',
  'qwen-ane',
  'custom',
]);
const ASSURANCE = new Set<ProviderModelAssurance>([
  'contentVerified',
  'providerAttested',
  'opaqueVersioned',
  'unknown',
]);
const PROFILE_KEYS = [
  'schema',
  'providerId',
  'providerKind',
  'modelIdentityDigest',
  'modelAssurance',
  'executionSemanticsDigest',
  'normalizerDigest',
  'observationABIDigest',
  'providerProfileDigest',
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function requireText(value: string, field: string): Uint8Array {
  if (value.length === 0 || value.includes('\0')) {
    throw new TypeError(`${field} must be non-empty and NUL-free`);
  }
  return Buffer.from(value, 'utf8');
}

function requireDigest(value: string, field: string): Uint8Array {
  if (!DIGEST.test(value)) throw new TypeError(`${field} must be canonical sha256`);
  return Buffer.from(value.slice('sha256:'.length), 'hex');
}

function components(input: ProviderExecutionProfileInput): TaggedIdentityComponent[] {
  if (!KINDS.has(input.providerKind)) {
    throw new TypeError('providerKind is not registered');
  }
  if (!ASSURANCE.has(input.modelAssurance)) {
    throw new TypeError('modelAssurance is not registered');
  }
  return [
    { tag: 1, data: requireText(input.providerId, 'providerId') },
    { tag: 2, data: requireText(input.providerKind, 'providerKind') },
    { tag: 3, data: requireDigest(input.modelIdentityDigest, 'modelIdentityDigest') },
    { tag: 4, data: requireText(input.modelAssurance, 'modelAssurance') },
    { tag: 5, data: requireDigest(input.executionSemanticsDigest, 'executionSemanticsDigest') },
    { tag: 6, data: requireDigest(input.normalizerDigest, 'normalizerDigest') },
    { tag: 7, data: requireDigest(input.observationABIDigest, 'observationABIDigest') },
  ];
}

export function deriveProviderExecutionProfile(
  input: ProviderExecutionProfileInput,
): Readonly<ProviderExecutionProfile> {
  const providerProfileDigest = digestTaggedIdentity(
    'ANVIL.ProviderExecutionProfile.v1',
    components(input),
  );
  return Object.freeze({
    schema: 'anvil.provider-execution-profile.v1' as const,
    providerId: input.providerId,
    providerKind: input.providerKind,
    modelIdentityDigest: input.modelIdentityDigest,
    modelAssurance: input.modelAssurance,
    executionSemanticsDigest: input.executionSemanticsDigest,
    normalizerDigest: input.normalizerDigest,
    observationABIDigest: input.observationABIDigest,
    providerProfileDigest,
  });
}

export function verifyProviderExecutionProfile(
  value: unknown,
): value is ProviderExecutionProfile {
  try {
    if (!isObject(value) || !exactKeys(value, PROFILE_KEYS)) return false;
    if (value.schema !== 'anvil.provider-execution-profile.v1') return false;
    if (
      typeof value.providerId !== 'string' ||
      typeof value.providerKind !== 'string' ||
      typeof value.modelIdentityDigest !== 'string' ||
      typeof value.modelAssurance !== 'string' ||
      typeof value.executionSemanticsDigest !== 'string' ||
      typeof value.normalizerDigest !== 'string' ||
      typeof value.observationABIDigest !== 'string' ||
      typeof value.providerProfileDigest !== 'string'
    ) return false;

    const recomputed = deriveProviderExecutionProfile({
      providerId: value.providerId,
      providerKind: value.providerKind as SemanticProviderKind,
      modelIdentityDigest: value.modelIdentityDigest,
      modelAssurance: value.modelAssurance as ProviderModelAssurance,
      executionSemanticsDigest: value.executionSemanticsDigest,
      normalizerDigest: value.normalizerDigest,
      observationABIDigest: value.observationABIDigest,
    });
    return recomputed.providerProfileDigest === value.providerProfileDigest;
  } catch {
    return false;
  }
}
