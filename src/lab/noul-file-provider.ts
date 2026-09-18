import { readFileSync } from 'node:fs';
import { sha256Digest } from './recovery.js';
import type { Digest256 } from './identity.js';
import type { MappedObservationProvider } from './observation-arm.js';
import {
  deriveLocalModelIdentity,
  deriveExecutionSemanticsIdentity,
  type ExecutionBackend,
  type LocalModelIdentity,
  type ExecutionSemanticsIdentity,
} from './execution-profile.js';
import {
  deriveProviderExecutionProfile,
  type ProviderExecutionProfile,
  type SemanticProviderKind,
} from './provider-profile.js';
import {
  MAPPED_DECISION_RESPONSE_SCHEMA,
  MAPPED_OBSERVATION_AXES,
  type MappedDecisionRequest,
  type MappedDecisionResponse,
} from './types.js';

// File-backed provider bridge. A native runner (Swift/CoreML on Neo) emits a
// JSONL of measured probability observations. This adapter only TRANSLATES
// those measurements into the Observation ABI response — it never invents
// semantic judgments, and each response is bound to the exact request by
// request_id and to the exact shown view bytes by candidateViewDigest.

export const NOUL_RECORD_SCHEMA = 'anvil.noul-observation.v1';
export const NOUL_NORMALIZER_ID = 'anvil.noul-yesno-softmax-normalizer.v1';

export interface NoulRecord {
  schema: 'anvil.noul-observation.v1';
  // sha256 of the exact semantic-view JSON the native runner was shown.
  candidateViewDigest: Digest256;
  requestId: string;
  candidateId: string;
  // axis -> P(axis holds) in [0,1], derived from the model's softmax over
  // registered yes/no token ids for that axis' probe prompt.
  axisProbabilities: Record<string, number>;
  probeMode: 'absolute' | 'conditional';
  yesTokenIds: readonly number[];
  noTokenIds: readonly number[];
  promptDigests: Record<string, Digest256>;
  timingsMs: { prefill: number; decode: number };
}

export function validateNoulRecord(value: unknown): NoulRecord {
  const v = value as NoulRecord;
  if (v?.schema !== NOUL_RECORD_SCHEMA) throw new Error('noul record: bad schema');
  if (typeof v.requestId !== 'string' || v.requestId.length === 0) {
    throw new Error('noul record: bad requestId');
  }
  if (typeof v.candidateId !== 'string' || v.candidateId.length === 0) {
    throw new Error('noul record: bad candidateId');
  }
  if (typeof v.candidateViewDigest !== 'string' || !v.candidateViewDigest.startsWith('sha256:')) {
    throw new Error('noul record: bad candidateViewDigest');
  }
  if (typeof v.promptDigests !== 'object' || v.promptDigests === null) {
    throw new Error('noul record: bad promptDigests');
  }
  for (const axis of MAPPED_OBSERVATION_AXES) {
    const pd = v.promptDigests[axis];
    if (typeof pd !== 'string' || !pd.startsWith('sha256:')) {
      throw new Error(`noul record: missing prompt digest for ${axis}`);
    }
  }
  for (const axis of MAPPED_OBSERVATION_AXES) {
    const p = v.axisProbabilities?.[axis];
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) {
      throw new Error(`noul record: bad probability for ${axis}`);
    }
  }
  return v;
}

export function loadNoulLog(path: string): readonly NoulRecord[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => validateNoulRecord(JSON.parse(line)));
}

// Canonical digest of the semantic-view slice handed to the native runner.
// The runner must emit a record whose candidateViewDigest equals this value —
// proof it scored exactly the bytes the request carried.
export function candidateViewDigest(
  request: MappedDecisionRequest,
  candidateId: string,
): Digest256 {
  const view = request.candidate_views.find((c) => c.candidate_id === candidateId);
  if (!view) throw new Error(`unknown candidate ${candidateId}`);
  return sha256Digest(JSON.stringify({
    schema: 'anvil.noul-candidate-view.v1',
    requestId: request.request_id,
    candidateId: view.candidate_id,
    sourceDigest: view.source_digest,
    hardRoots: view.hard_roots,
    semanticView: view.semantic_view,
    mission: request.shared_conversation_state.mission,
  }));
}

export function createNoulFileProvider(
  records: readonly NoulRecord[],
): MappedObservationProvider {
  const byKey = new Map<string, NoulRecord>();
  for (const r of records) {
    const key = `${r.requestId}:${r.candidateId}`;
    if (byKey.has(key)) throw new Error(`duplicate noul record ${key}`);
    byKey.set(key, r);
  }
  return (request: MappedDecisionRequest): MappedDecisionResponse => {
    const observations = request.candidate_views.map((view) => {
      const key = `${request.request_id}:${view.candidate_id}`;
      const record = byKey.get(key);
      if (!record) {
        throw new Error(`no measured noul record for ${key}`);
      }
      const expected = candidateViewDigest(request, view.candidate_id);
      if (record.candidateViewDigest !== expected) {
        throw new Error(
          `noul view digest mismatch for ${view.candidate_id}: runner saw different bytes`,
        );
      }
      const obs: Record<string, { noul: number }> = { candidate_id: view.candidate_id } as never;
      for (const axis of MAPPED_OBSERVATION_AXES) {
        obs[axis] = { noul: record.axisProbabilities[axis] };
      }
      return obs;
    });
    return {
      schema: MAPPED_DECISION_RESPONSE_SCHEMA,
      request_id: request.request_id,
      observations: observations as never,
    };
  };
}

// Neo LFM2.5 identity bundle — all digests measured on the machine.
export interface NeoLfmIdentity {
  model: Readonly<LocalModelIdentity>;
  semantics: Readonly<ExecutionSemanticsIdentity>;
  profile: Readonly<ProviderExecutionProfile>;
  normalizerDigest: Digest256;
  observationABIDigest: Digest256;
}

export function deriveNoulNormalizerDigest(): Digest256 {
  return sha256Digest(JSON.stringify({
    schema: 'anvil.noul-normalizer.v1',
    id: NOUL_NORMALIZER_ID,
    rule: 'P(axis) = softmax mass of yes-class ids / (yes-class + no-class mass); absolute mode renormalized over full vocab',
    yesTokenIds: [11683, 12447, 18171, 17550],
    noTokenIds: [2243, 4547, 794, 2752],
  }));
}

export function deriveObservationABIDigest(): Digest256 {
  return sha256Digest(JSON.stringify({
    schema: 'anvil.observation-abi-identity.v1',
    abiVersion: 'anvil.semantic-observation-abi.v1',
    requestSchema: 'anvil.mapped-decision-request.v0',
    responseSchema: 'anvil.mapped-decision-response.v0',
    axes: MAPPED_OBSERVATION_AXES,
  }));
}

export function neoLfmIdentity(input: {
  packageDigest: Digest256;
  tokenizerDigest: Digest256;
  weightsDigest?: Digest256;
  quantization: string;
  releaseId?: string;
  backend: ExecutionBackend;
  runtimeVersion: string;
  compilerDigest: Digest256;
  contextWindow: number;
  samplingDigest: Digest256;
  hardwareSemanticsClass?: string;
  providerKind?: SemanticProviderKind;
}): NeoLfmIdentity {
  const model = deriveLocalModelIdentity({
    modelName: 'lfm2.5-2.6b-kvio-d1p1',
    packageDigest: input.packageDigest,
    tokenizerDigest: input.tokenizerDigest,
    ...(input.weightsDigest !== undefined ? { weightsDigest: input.weightsDigest } : {}),
    quantization: input.quantization,
    ...(input.releaseId !== undefined ? { releaseId: input.releaseId } : {}),
  });
  const semantics = deriveExecutionSemanticsIdentity({
    backend: input.backend,
    runtimeVersion: input.runtimeVersion,
    compilerDigest: input.compilerDigest,
    contextWindow: input.contextWindow,
    quantization: input.quantization,
    samplingDigest: input.samplingDigest,
    ...(input.hardwareSemanticsClass !== undefined
      ? { hardwareSemanticsClass: input.hardwareSemanticsClass }
      : {}),
  });
  const normalizerDigest = deriveNoulNormalizerDigest();
  const observationABIDigest = deriveObservationABIDigest();
  const profile = deriveProviderExecutionProfile({
    providerId: 'neo-lfm2.5-local',
    providerKind: input.providerKind ?? 'custom',
    modelIdentityDigest: model.identityDigest,
    modelAssurance: model.assurance,
    executionSemanticsDigest: semantics.identityDigest,
    normalizerDigest,
    observationABIDigest,
  });
  return Object.freeze({ model, semantics, profile, normalizerDigest, observationABIDigest });
}
