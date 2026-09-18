import { readFileSync } from 'node:fs';
import { sha256Digest } from './recovery.js';
import type { Digest256 } from './identity.js';
import type { SemanticObservationProviderV2 } from './observation-arm-v2.js';
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
  MODELED_SEMANTIC_AXES_V2,
  SEMANTIC_DECISION_RESPONSE_SCHEMA_V2,
  SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
  validateSemanticDecisionRequestV2,
  type SemanticDecisionRequestV2,
  type SemanticDecisionResponseV2,
  type ModeledSemanticAxisV2,
} from './semantic-contract-v2.js';
import { SEMANTIC_AXIS_SPEC_DIGEST_V2 } from './semantic-axis-spec-v2.js';

// V2 file-backed provider bridge. The native runner (Swift/CoreML on Neo)
// emits measured V2 probability records; this adapter TRANSLATES them into
// the V2 Observation ABI response — never inventing semantic judgments.
//
// Version boundaries enforced here:
//   * record schema must be anvil.noul-observation.v2 — a V1 record fails
//   * the axis set is exactly the four V2 modeled axes — recoverable is
//     rejected wherever it appears (V2 recovery is mechanical-only)
//   * the bound view identity is anvil.noul-candidate-view.v2 over the V2
//     request — a V1 candidateViewDigest cannot equal it
//   * telemetry (per-token conditional AND absolute probabilities) is
//     preserved in the record but never crosses into the response —
//     measurement telemetry is not semantic authority

export const NOUL_RECORD_SCHEMA_V2 = 'anvil.noul-observation.v2';
export const NOUL_NORMALIZER_ID_V2 = 'anvil.noul-yesno-softmax-normalizer.v2';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const AXIS_SET = new Set<string>(MODELED_SEMANTIC_AXES_V2);

export interface NoulAxisTelemetry {
  // Conditional probabilities normalized across the registered probe-token
  // subset, per token id (string form for JSON key stability).
  probs: Record<string, number>;
  // The same probe-token probabilities normalized over the full vocabulary.
  // Measurement telemetry only — never semantic authority.
  abs: Record<string, number>;
}

export interface NoulRecordV2 {
  schema: typeof NOUL_RECORD_SCHEMA_V2;
  candidateViewDigest: Digest256;
  requestId: string;
  candidateId: string;
  providerProfileDigest: Digest256;
  axisSpecDigest: Digest256;
  axisProbabilities: Record<ModeledSemanticAxisV2, number>;
  promptDigests: Record<ModeledSemanticAxisV2, Digest256>;
  probeMode: 'absolute' | 'conditional';
  yesTokenIds: readonly number[];
  noTokenIds: readonly number[];
  telemetry: Record<ModeledSemanticAxisV2, NoulAxisTelemetry>;
  timingsMs: { prefill: number; decode: number };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function containsRecoverable(value: unknown, path: string): string | null {
  if (!isObject(value) && !Array.isArray(value)) return null;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'recoverable') return `${path}.${key}`;
    const found = containsRecoverable(nested, `${path}.${key}`);
    if (found !== null) return found;
  }
  return null;
}

function exactAxisMap(
  value: unknown,
  field: string,
): Record<ModeledSemanticAxisV2, unknown> {
  if (!isObject(value)) {
    throw new Error(`noul v2 record: ${field} must be an object`);
  }
  const keys = Object.keys(value);
  const stray = keys.find((k) => !AXIS_SET.has(k));
  if (stray !== undefined) {
    throw new Error(
      `noul v2 record: ${field} carries non-V2 axis '${stray}' (recoverable is mechanical-only)`,
    );
  }
  for (const axis of MODELED_SEMANTIC_AXES_V2) {
    if (!(axis in value)) {
      throw new Error(`noul v2 record: missing axis ${axis} in ${field}`);
    }
  }
  return value as Record<ModeledSemanticAxisV2, unknown>;
}

export function validateNoulRecordV2(value: unknown): NoulRecordV2 {
  const v = value as NoulRecordV2;
  if (v?.schema !== NOUL_RECORD_SCHEMA_V2) {
    throw new Error('noul v2 record: bad schema — expected anvil.noul-observation.v2');
  }
  const bad = containsRecoverable(v, 'record');
  if (bad !== null) {
    throw new Error(`noul v2 record: recoverable present at ${bad} — V2 has no modeled recoverable`);
  }
  if (typeof v.requestId !== 'string' || v.requestId.length === 0) {
    throw new Error('noul v2 record: bad requestId');
  }
  if (typeof v.candidateId !== 'string' || v.candidateId.length === 0) {
    throw new Error('noul v2 record: bad candidateId');
  }
  if (typeof v.candidateViewDigest !== 'string' || !DIGEST.test(v.candidateViewDigest)) {
    throw new Error('noul v2 record: bad candidateViewDigest');
  }
  if (typeof v.providerProfileDigest !== 'string' || !DIGEST.test(v.providerProfileDigest)) {
    throw new Error('noul v2 record: bad providerProfileDigest');
  }
  if (typeof v.axisSpecDigest !== 'string' || !DIGEST.test(v.axisSpecDigest)) {
    throw new Error('noul v2 record: bad axisSpecDigest');
  }
  const probs = exactAxisMap(v.axisProbabilities, 'axisProbabilities');
  for (const axis of MODELED_SEMANTIC_AXES_V2) {
    const p = probs[axis];
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) {
      throw new Error(`noul v2 record: bad probability for ${axis}`);
    }
  }
  const digests = exactAxisMap(v.promptDigests, 'promptDigests');
  for (const axis of MODELED_SEMANTIC_AXES_V2) {
    const pd = digests[axis];
    if (typeof pd !== 'string' || !DIGEST.test(pd)) {
      throw new Error(`noul v2 record: missing V2 prompt digest for ${axis}`);
    }
  }
  const telemetry = exactAxisMap(v.telemetry, 'telemetry');
  for (const axis of MODELED_SEMANTIC_AXES_V2) {
    const t = telemetry[axis];
    if (!isObject(t) || !isObject(t.probs) || !isObject(t.abs)) {
      throw new Error(`noul v2 record: telemetry for ${axis} must carry probs and abs`);
    }
    for (const [kind, map] of [['probs', t.probs], ['abs', t.abs]] as const) {
      for (const [tokenId, p] of Object.entries(map)) {
        if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) {
          throw new Error(`noul v2 record: telemetry.${axis}.${kind}[${tokenId}] not finite in [0,1]`);
        }
      }
    }
  }
  if (v.probeMode !== 'conditional' && v.probeMode !== 'absolute') {
    throw new Error('noul v2 record: bad probeMode');
  }
  if (!Array.isArray(v.yesTokenIds) || !Array.isArray(v.noTokenIds)) {
    throw new Error('noul v2 record: probe token id sets required');
  }
  return v;
}

export function loadNoulLogV2(path: string): readonly NoulRecordV2[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => validateNoulRecordV2(JSON.parse(line)));
}

// V2 candidate-view identity. Binds schema version + request + candidate +
// source + hard roots + semantic view + mission + the V2 decision contract
// and semantic program — a V1 anvil.noul-candidate-view.v1 digest cannot
// equal this value even if the visible bytes look similar.
export function candidateViewDigestV2(
  request: SemanticDecisionRequestV2,
  candidateId: string,
): Digest256 {
  const view = request.candidate_views.find((c) => c.candidate_id === candidateId);
  if (!view) throw new Error(`unknown candidate ${candidateId}`);
  return sha256Digest(JSON.stringify({
    schema: 'anvil.noul-candidate-view.v2',
    requestId: request.request_id,
    candidateId: view.candidate_id,
    sourceDigest: view.source_digest,
    hardRoots: view.hard_roots,
    semanticView: view.semantic_view,
    mission: request.shared_conversation_state.mission,
    decisionContract: request.decision_contract,
    semanticProgram: request.semantic_program,
  }));
}

export interface NoulFileProviderV2Options {
  expectedProfileDigest?: Digest256;
}

export function createNoulFileProviderV2(
  records: readonly NoulRecordV2[],
  options: NoulFileProviderV2Options = {},
): SemanticObservationProviderV2 {
  const byKey = new Map<string, NoulRecordV2>();
  for (const r of records) {
    const key = `${r.requestId}:${r.candidateId}`;
    if (byKey.has(key)) throw new Error(`duplicate noul v2 record ${key}`);
    byKey.set(key, r);
  }
  return (request: SemanticDecisionRequestV2): SemanticDecisionResponseV2 => {
    const validation = validateSemanticDecisionRequestV2(request);
    if (!validation.ok) {
      throw new Error(`noul v2 provider: invalid V2 request ${validation.code}`);
    }
    const observations = request.candidate_views.map((view) => {
      const key = `${request.request_id}:${view.candidate_id}`;
      const record = byKey.get(key);
      if (!record) {
        throw new Error(`no measured noul v2 record for ${key}`);
      }
      const expectedView = candidateViewDigestV2(request, view.candidate_id);
      if (record.candidateViewDigest !== expectedView) {
        throw new Error(
          `noul v2 view digest mismatch for ${view.candidate_id}: runner saw different bytes`,
        );
      }
      if (
        options.expectedProfileDigest !== undefined &&
        record.providerProfileDigest !== options.expectedProfileDigest
      ) {
        throw new Error(
          `noul v2 provider profile mismatch for ${view.candidate_id}: record binds a stale or foreign profile`,
        );
      }
      return {
        candidate_id: view.candidate_id,
        evidence_sufficient: { noul: record.axisProbabilities.evidence_sufficient },
        still_needed: { noul: record.axisProbabilities.still_needed },
        full_content_needed: { noul: record.axisProbabilities.full_content_needed },
        unresolved_evidence: { noul: record.axisProbabilities.unresolved_evidence },
      };
    });
    return {
      schema: SEMANTIC_DECISION_RESPONSE_SCHEMA_V2,
      request_id: request.request_id,
      observations,
    };
  };
}

// Neo LFM2.5 V2 identity bundle — same physical model, different ABI.
export interface NeoLfmIdentityV2 {
  model: Readonly<LocalModelIdentity>;
  semantics: Readonly<ExecutionSemanticsIdentity>;
  profile: Readonly<ProviderExecutionProfile>;
  normalizerDigest: Digest256;
  observationABIDigest: Digest256;
  axisSpecDigest: Digest256;
}

export function deriveNoulNormalizerDigestV2(): Digest256 {
  return sha256Digest(JSON.stringify({
    schema: 'anvil.noul-normalizer.v2',
    id: NOUL_NORMALIZER_ID_V2,
    rule: 'P(axis) = softmax mass of yes-class ids / (yes-class + no-class mass) over the registered probe subset; absolute probe-token mass preserved as telemetry only',
    yesTokenIds: [11683, 12447, 18171, 17550],
    noTokenIds: [2243, 4547, 794, 2752],
    axisSpecDigest: SEMANTIC_AXIS_SPEC_DIGEST_V2,
    observationAbi: 'anvil.semantic-observation-abi.v2',
  }));
}

export function neoLfmIdentityV2(input: {
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
}): NeoLfmIdentityV2 {
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
  const normalizerDigest = deriveNoulNormalizerDigestV2();
  const profile = deriveProviderExecutionProfile({
    providerId: 'neo-lfm2.5-local-v2',
    providerKind: input.providerKind ?? 'custom',
    modelIdentityDigest: model.identityDigest,
    modelAssurance: model.assurance,
    executionSemanticsDigest: semantics.identityDigest,
    normalizerDigest,
    observationABIDigest: SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
  });
  return Object.freeze({
    model,
    semantics,
    profile,
    normalizerDigest,
    observationABIDigest: SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
    axisSpecDigest: SEMANTIC_AXIS_SPEC_DIGEST_V2,
  });
}
