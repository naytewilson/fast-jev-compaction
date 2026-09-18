import {
  digestTaggedIdentity,
  type Digest256,
  type TaggedIdentityComponent,
} from './identity.js';

export type ModelIdentityAssurance =
  | 'contentVerified'
  | 'providerAttested'
  | 'opaqueVersioned'
  | 'unknown';

export type ExecutionBackend =
  | 'coreml-ane'
  | 'coreml-auto'
  | 'cpu'
  | 'remote';

export interface LocalModelIdentityInput {
  modelName: string;
  packageDigest: Digest256;
  tokenizerDigest: Digest256;
  weightsDigest?: Digest256;
  quantization: string;
  releaseId?: string;
}

export interface LocalModelIdentity extends LocalModelIdentityInput {
  assurance: 'contentVerified';
  identityDigest: Digest256;
}

export interface ExecutionSemanticsInput {
  backend: ExecutionBackend;
  runtimeVersion: string;
  compilerDigest: Digest256;
  contextWindow: number;
  quantization: string;
  samplingDigest: Digest256;
  hardwareSemanticsClass?: string;
}

export interface ExecutionSemanticsIdentity extends ExecutionSemanticsInput {
  identityDigest: Digest256;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const BACKENDS = new Set<ExecutionBackend>([
  'coreml-ane',
  'coreml-auto',
  'cpu',
  'remote',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireDigest(value: Digest256, field: string): Uint8Array {
  if (!DIGEST.test(value)) {
    throw new TypeError(`${field} must be canonical sha256`);
  }
  return Buffer.from(value.slice('sha256:'.length), 'hex');
}

function requireText(value: string, field: string): Uint8Array {
  if (value.length === 0 || value.includes('\0')) {
    throw new TypeError(`${field} must be non-empty and NUL-free`);
  }
  return Buffer.from(value, 'utf8');
}

function optionalText(value: string | undefined, field: string): Uint8Array | undefined {
  if (value === undefined) return undefined;
  return requireText(value, field);
}

export function deriveLocalModelIdentity(
  input: LocalModelIdentityInput,
): Readonly<LocalModelIdentity> {
  const components: TaggedIdentityComponent[] = [
    { tag: 1, data: requireText(input.modelName, 'modelName') },
    { tag: 2, data: requireDigest(input.packageDigest, 'packageDigest') },
    { tag: 3, data: requireDigest(input.tokenizerDigest, 'tokenizerDigest') },
    { tag: 5, data: requireText(input.quantization, 'quantization') },
  ];

  if (input.weightsDigest !== undefined) {
    components.splice(3, 0, {
      tag: 4,
      data: requireDigest(input.weightsDigest, 'weightsDigest'),
    });
  }
  const release = optionalText(input.releaseId, 'releaseId');
  if (release !== undefined) components.push({ tag: 6, data: release });

  const identityDigest = digestTaggedIdentity(
    'ANVIL.LocalModelIdentity.v1',
    components,
  );

  return Object.freeze({
    modelName: input.modelName,
    packageDigest: input.packageDigest,
    tokenizerDigest: input.tokenizerDigest,
    ...(input.weightsDigest !== undefined ? { weightsDigest: input.weightsDigest } : {}),
    quantization: input.quantization,
    ...(input.releaseId !== undefined ? { releaseId: input.releaseId } : {}),
    assurance: 'contentVerified' as const,
    identityDigest,
  });
}

export function verifyLocalModelIdentity(value: unknown): value is LocalModelIdentity {
  try {
    if (!isObject(value)) return false;
    const allowed = new Set([
      'modelName',
      'packageDigest',
      'tokenizerDigest',
      'weightsDigest',
      'quantization',
      'releaseId',
      'assurance',
      'identityDigest',
    ]);
    if (Object.keys(value).some((key) => !allowed.has(key))) return false;
    if (
      typeof value.modelName !== 'string' ||
      typeof value.packageDigest !== 'string' ||
      typeof value.tokenizerDigest !== 'string' ||
      typeof value.quantization !== 'string' ||
      value.assurance !== 'contentVerified' ||
      typeof value.identityDigest !== 'string'
    ) return false;
    if (value.weightsDigest !== undefined && typeof value.weightsDigest !== 'string') return false;
    if (value.releaseId !== undefined && typeof value.releaseId !== 'string') return false;

    const recomputed = deriveLocalModelIdentity({
      modelName: value.modelName,
      packageDigest: value.packageDigest,
      tokenizerDigest: value.tokenizerDigest,
      ...(value.weightsDigest !== undefined ? { weightsDigest: value.weightsDigest } : {}),
      quantization: value.quantization,
      ...(value.releaseId !== undefined ? { releaseId: value.releaseId } : {}),
    });
    return recomputed.identityDigest === value.identityDigest;
  } catch {
    return false;
  }
}

function computeExecutionSemanticsDigest(
  input: ExecutionSemanticsInput,
): Digest256 {
  if (!BACKENDS.has(input.backend)) {
    throw new TypeError('backend is not a registered execution backend');
  }
  if (!Number.isSafeInteger(input.contextWindow) || input.contextWindow <= 0) {
    throw new TypeError('contextWindow must be a positive safe integer');
  }

  const components: TaggedIdentityComponent[] = [
    { tag: 1, data: requireText(input.backend, 'backend') },
    { tag: 2, data: requireText(input.runtimeVersion, 'runtimeVersion') },
    { tag: 3, data: requireDigest(input.compilerDigest, 'compilerDigest') },
    { tag: 4, data: Buffer.from(String(input.contextWindow), 'utf8') },
    { tag: 5, data: requireText(input.quantization, 'quantization') },
    { tag: 6, data: requireDigest(input.samplingDigest, 'samplingDigest') },
  ];

  const hardware = optionalText(input.hardwareSemanticsClass, 'hardwareSemanticsClass');
  if (hardware !== undefined) components.push({ tag: 7, data: hardware });

  return digestTaggedIdentity('ANVIL.ExecutionSemantics.v1', components);
}

export function deriveExecutionSemanticsDigest(
  input: ExecutionSemanticsInput,
): Digest256 {
  return computeExecutionSemanticsDigest(input);
}

export function deriveExecutionSemanticsIdentity(
  input: ExecutionSemanticsInput,
): Readonly<ExecutionSemanticsIdentity> {
  return Object.freeze({
    ...input,
    identityDigest: computeExecutionSemanticsDigest(input),
  });
}

export function verifyExecutionSemanticsIdentity(
  value: unknown,
): value is ExecutionSemanticsIdentity {
  try {
    if (!isObject(value)) return false;
    const allowed = new Set([
      'backend',
      'runtimeVersion',
      'compilerDigest',
      'contextWindow',
      'quantization',
      'samplingDigest',
      'hardwareSemanticsClass',
      'identityDigest',
    ]);
    if (Object.keys(value).some((key) => !allowed.has(key))) return false;
    if (
      typeof value.backend !== 'string' ||
      typeof value.runtimeVersion !== 'string' ||
      typeof value.compilerDigest !== 'string' ||
      typeof value.contextWindow !== 'number' ||
      typeof value.quantization !== 'string' ||
      typeof value.samplingDigest !== 'string' ||
      typeof value.identityDigest !== 'string'
    ) return false;
    if (
      value.hardwareSemanticsClass !== undefined &&
      typeof value.hardwareSemanticsClass !== 'string'
    ) return false;

    const recomputed = deriveExecutionSemanticsIdentity({
      backend: value.backend as ExecutionBackend,
      runtimeVersion: value.runtimeVersion,
      compilerDigest: value.compilerDigest,
      contextWindow: value.contextWindow,
      quantization: value.quantization,
      samplingDigest: value.samplingDigest,
      ...(value.hardwareSemanticsClass !== undefined
        ? { hardwareSemanticsClass: value.hardwareSemanticsClass }
        : {}),
    });
    return recomputed.identityDigest === value.identityDigest;
  } catch {
    return false;
  }
}
