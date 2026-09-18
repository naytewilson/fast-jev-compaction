import { carveHardRoots } from './hard-roots.js';
import {
  compileContextRetentionProgramV2,
  reassembleSemanticObservationsV2,
  validateSemanticDecisionRequestV2,
  type SemanticCandidateObservationV2,
  type SemanticDecisionRequestV2,
} from './semantic-contract-v2.js';
import {
  evaluateMechanicalRecovery,
  type MechanicalRecoveryEvidence,
} from './mechanical-recovery.js';
import {
  decideSemanticPolicyV2,
  type ObservationPolicyThresholdsV2,
  type SemanticPolicyDecisionV2,
} from './semantic-policy-v2.js';
export type {
  ObservationPolicyThresholdsV2,
  SemanticPolicyDecisionV2,
} from './semantic-policy-v2.js';
import {
  fullPresentation,
  type ReplayRun,
  type ReplayTrace,
} from './replay.js';
import {
  createReplayReceipt,
  type ReplayProviderUsage,
  type ReplayReceipt,
} from './receipt.js';
import { sha256Digest, type InMemoryCAS } from './recovery.js';
import type {
  HardRootEligible,
  ProfileIdentity,
} from './types.js';

export interface ObservationProfilesV2 {
  decision_contract: ProfileIdentity;
  execution_profile: ProfileIdentity;
  calibration_profile: ProfileIdentity;
  policy_profile: ProfileIdentity;
}

export interface ObservationProviderMetadataV2 {
  requested_model?: string;
  effective_model?: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_usd?: number | null;
}

export type SemanticObservationProviderV2 = (
  request: SemanticDecisionRequestV2,
) => Promise<unknown> | unknown;

type ProviderEnvelope = {
  mapped_response: unknown;
  provider_metadata: ObservationProviderMetadataV2;
};

export type ObservationReplayRunV2 = ReplayRun & {
  receipts: ReplayReceipt[];
  observations: readonly SemanticCandidateObservationV2[] | null;
  mechanicalRecovery: readonly Readonly<MechanicalRecoveryEvidence>[];
  policy: readonly Readonly<SemanticPolicyDecisionV2>[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalMetric(value: unknown): value is number | null | undefined {
  return value === undefined ||
    value === null ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function parseProviderEnvelope(value: unknown):
  | { kind: 'bare'; response: unknown }
  | { kind: 'envelope'; envelope: ProviderEnvelope }
  | { kind: 'invalid' } {
  if (!isObject(value) || !Object.prototype.hasOwnProperty.call(value, 'mapped_response')) {
    return { kind: 'bare', response: value };
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !keys.includes('mapped_response') ||
    !keys.includes('provider_metadata') ||
    !isObject(value.provider_metadata)
  ) {
    return { kind: 'invalid' };
  }
  const metadata = value.provider_metadata;
  const allowed = [
    'requested_model',
    'effective_model',
    'input_tokens',
    'output_tokens',
    'cost_usd',
  ];
  if (
    Object.keys(metadata).some((key) => !allowed.includes(key)) ||
    typeof metadata.requested_model !== 'string' ||
    metadata.requested_model.length === 0 ||
    typeof metadata.effective_model !== 'string' ||
    metadata.effective_model.length === 0 ||
    !optionalMetric(metadata.input_tokens) ||
    !optionalMetric(metadata.output_tokens) ||
    !optionalMetric(metadata.cost_usd)
  ) {
    return { kind: 'invalid' };
  }

  return {
    kind: 'envelope',
    envelope: {
      mapped_response: value.mapped_response,
      provider_metadata: {
        requested_model: metadata.requested_model,
        effective_model: metadata.effective_model,
        input_tokens: metadata.input_tokens ?? null,
        output_tokens: metadata.output_tokens ?? null,
        cost_usd: metadata.cost_usd ?? null,
      },
    },
  };
}

function validateThresholds(thresholds: ObservationPolicyThresholdsV2): void {
  for (const [field, value] of Object.entries(thresholds)) {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1
    ) {
      throw new TypeError(`${field} must be finite in [0,1]`);
    }
  }
}

function freezeObservations(
  observations: readonly SemanticCandidateObservationV2[],
): readonly Readonly<SemanticCandidateObservationV2>[] {
  return Object.freeze(observations.map((observation) => Object.freeze({
    candidate_id: observation.candidate_id,
    evidence_sufficient: Object.freeze({ ...observation.evidence_sufficient }),
    still_needed: Object.freeze({ ...observation.still_needed }),
    full_content_needed: Object.freeze({ ...observation.full_content_needed }),
    unresolved_evidence: Object.freeze({ ...observation.unresolved_evidence }),
  })));
}

function buildRequest(
  trace: ReplayTrace,
  profiles: ObservationProfilesV2,
  carvedByID: ReadonlyMap<string, HardRootEligible>,
): SemanticDecisionRequestV2 {
  const program = compileContextRetentionProgramV2(profiles.decision_contract);
  const candidate_views = [...trace.candidates]
    .sort((a, b) => a.candidate_id.localeCompare(b.candidate_id))
    .map((candidate) => {
      const carved = carvedByID.get(candidate.candidate_id);
      if (!carved) {
        throw new Error(`missing hard-root preflight for ${candidate.candidate_id}`);
      }
      return {
        candidate_id: candidate.candidate_id,
        source_digest: candidate.recovery.source_digest,
        source_kind: 'tool_result' as const,
        recovery_ref: candidate.recovery.recovery_ref,
        byte_count: candidate.recovery.byte_count,
        hard_roots: carved.hardRoots,
        semantic_view: {
          head: carved.hardRoots.first_lines.join('\n'),
          tail: carved.hardRoots.last_lines.join('\n'),
          selected_chunks: [],
          omitted_bytes: carved.omitted_stdout_bytes,
        },
      };
    });

  return {
    schema: 'anvil.semantic-decision-request.v2',
    request_id: `sdr-${trace.trace_id}`,
    source_run_id: trace.source_run_id,
    decision_contract: profiles.decision_contract,
    semantic_program: {
      id: program.id,
      version: program.version,
      digest: program.programDigest,
    },
    execution_profile: profiles.execution_profile,
    calibration_profile: profiles.calibration_profile,
    policy_profile: profiles.policy_profile,
    shared_conversation_state: {
      mission: trace.shared_state || 'preserve source-bound evidence',
      recent_turns: [],
      active_constraints: [
        'semantic observer has no presentation authority',
        'recoverability is mechanical only',
      ],
      unresolved_failures: [],
      source_refs: trace.candidates.map(
        (candidate) => candidate.recovery.source_digest,
      ),
    },
    candidate_views,
  };
}

function digestJSON(value: unknown, fallbackLabel: string): string {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) return sha256Digest(fallbackLabel);
    return sha256Digest(encoded);
  } catch {
    return sha256Digest(fallbackLabel);
  }
}

function sourceTraceDigest(trace: ReplayTrace): string {
  return digestJSON({
    trace_id: trace.trace_id,
    source_run_id: trace.source_run_id,
    shared_state: trace.shared_state,
    candidates: trace.candidates,
  }, 'invalid-source-trace-v2');
}

function candidateSetDigest(trace: ReplayTrace): string {
  return digestJSON(
    [...trace.candidates]
      .sort((a, b) => a.candidate_id.localeCompare(b.candidate_id))
      .map((candidate) => ({
        candidate_id: candidate.candidate_id,
        source_digest: candidate.recovery.source_digest,
        recovery_ref: candidate.recovery.recovery_ref,
      })),
    'invalid-candidate-set-v2',
  );
}

function hardRootPolicyDigest(trace: ReplayTrace): string {
  return digestJSON({
    schema: 'anvil.hard-roots.v0',
    candidates: [...trace.candidates]
      .sort((a, b) => a.candidate_id.localeCompare(b.candidate_id))
      .map((candidate) => ({
        candidate_id: candidate.candidate_id,
        head_lines: candidate.head_lines,
        tail_lines: candidate.tail_lines,
        presentation_budget_bytes: candidate.presentation_budget_bytes,
        preserve_exit_status: true,
        preserve_all_stderr: true,
      })),
  }, 'invalid-hard-root-policy-v2');
}

function recoveryManifestDigest(trace: ReplayTrace): string {
  return digestJSON(
    [...trace.candidates]
      .sort((a, b) => a.candidate_id.localeCompare(b.candidate_id))
      .map((candidate) => ({
        candidate_id: candidate.candidate_id,
        ...candidate.recovery,
      })),
    'invalid-recovery-manifest-v2',
  );
}

type ReceiptContext = {
  request?: SemanticDecisionRequestV2;
  rawResponse?: unknown;
  observationDigest: string;
  dispositions: string[];
  errorCode: string | null;
  pristineFallback: boolean;
  latencyMs: number | null;
  providerMetadata?: ObservationProviderMetadataV2;
};

function makeReceipt(
  trace: ReplayTrace,
  profiles: ObservationProfilesV2,
  context: ReceiptContext,
): ReplayReceipt {
  const requestedModel =
    context.providerMetadata?.requested_model ?? profiles.execution_profile.id;
  const effectiveModel =
    context.providerMetadata?.effective_model ?? requestedModel;
  const usage: ReplayProviderUsage = {
    input_tokens: context.providerMetadata?.input_tokens ?? null,
    output_tokens: context.providerMetadata?.output_tokens ?? null,
    cost_usd: context.providerMetadata?.cost_usd ?? null,
  };
  return createReplayReceipt({
    receipt_schema: 'anvil.semantic-fabric-v2-replay-receipt.v0',
    trace_id: trace.trace_id,
    source_trace_digest: sourceTraceDigest(trace),
    source_run_id: trace.source_run_id,
    arm: 'D2',
    decision_contract_id: profiles.decision_contract.id,
    decision_contract_version: profiles.decision_contract.version,
    decision_contract_digest: profiles.decision_contract.digest,
    execution_profile_id: profiles.execution_profile.id,
    execution_profile_version: profiles.execution_profile.version,
    execution_profile_digest: profiles.execution_profile.digest,
    calibration_profile_id: profiles.calibration_profile.id,
    calibration_profile_version: profiles.calibration_profile.version,
    calibration_profile_digest: profiles.calibration_profile.digest,
    policy_profile_id: profiles.policy_profile.id,
    policy_profile_version: profiles.policy_profile.version,
    policy_profile_digest: profiles.policy_profile.digest,
    shared_state_digest: sha256Digest(trace.shared_state),
    candidate_set_digest: candidateSetDigest(trace),
    ordered_candidate_ids: [...trace.candidates]
      .sort((a, b) => a.candidate_id.localeCompare(b.candidate_id))
      .map((candidate) => candidate.candidate_id),
    provider_request_digest: context.request
      ? digestJSON(context.request, 'invalid-provider-request-v2')
      : sha256Digest('NO_PROVIDER_REQUEST_V2'),
    provider_response_digest: context.rawResponse !== undefined
      ? digestJSON(context.rawResponse, 'invalid-provider-response-v2')
      : sha256Digest('NO_PROVIDER_RESPONSE_V2'),
    observation_set_digest: context.observationDigest,
    hard_root_policy_digest: hardRootPolicyDigest(trace),
    recovery_manifest_digest: recoveryManifestDigest(trace),
    policy_dispositions: context.dispositions,
    dispositions: context.dispositions,
    provider_model_requested: requestedModel,
    provider_model_effective: effectiveModel,
    provider_usage: usage,
    latency_ms: context.latencyMs,
    error_code: context.errorCode,
    pristine_fallback: context.pristineFallback,
  });
}

function fallbackRun(
  trace: ReplayTrace,
  profiles: ObservationProfilesV2,
  mechanicalRecovery: readonly Readonly<MechanicalRecoveryEvidence>[],
  reason: string,
  context: Partial<Omit<
    ReceiptContext,
    'observationDigest' |
    'dispositions' |
    'errorCode' |
    'pristineFallback'
  >> = {},
): ObservationReplayRunV2 {
  const presentations = trace.candidates.map((candidate) =>
    fullPresentation(candidate, 'PRISTINE_FALLBACK'));
  const dispositions = presentations.map((x) => x.disposition);
  return {
    arm: 'D2',
    presentations,
    observations: null,
    mechanicalRecovery,
    policy: Object.freeze([]),
    receipts: [
      makeReceipt(trace, profiles, {
        request: context.request,
        rawResponse: context.rawResponse,
        observationDigest: sha256Digest(JSON.stringify({
          schema: 'anvil.semantic-fabric-v2-fallback-evidence.v0',
          reason,
          mechanicalRecovery,
        })),
        dispositions,
        errorCode: reason,
        pristineFallback: true,
        latencyMs: context.latencyMs ?? null,
        providerMetadata: context.providerMetadata,
      }),
    ],
  };
}

export async function runObservationOnlyArmV2(
  trace: ReplayTrace,
  cas: InMemoryCAS,
  profiles: ObservationProfilesV2,
  thresholds: ObservationPolicyThresholdsV2,
  provider: SemanticObservationProviderV2,
  providerMetadata?: ObservationProviderMetadataV2,
): Promise<ObservationReplayRunV2> {
  validateThresholds(thresholds);

  const mechanicalRecovery = Object.freeze(
    trace.candidates.map((candidate) =>
      evaluateMechanicalRecovery(cas, candidate)),
  );

  const carvedByID = new Map<string, HardRootEligible>();
  for (const candidate of trace.candidates) {
    const carved = carveHardRoots({
      exitStatus: candidate.exit_status,
      stdout: candidate.stdout,
      stderr: candidate.stderr,
      headLines: candidate.head_lines,
      tailLines: candidate.tail_lines,
      presentationBudgetBytes: candidate.presentation_budget_bytes,
    });
    if (carved.kind === 'PRISTINE') {
      return fallbackRun(
        trace,
        profiles,
        mechanicalRecovery,
        'hard_roots_exceed_budget',
        {
          providerMetadata,
        },
      );
    }
    carvedByID.set(candidate.candidate_id, carved);
  }

  const request = buildRequest(trace, profiles, carvedByID);
  const validation = validateSemanticDecisionRequestV2(request);
  if (!validation.ok) {
    return fallbackRun(
      trace,
      profiles,
      mechanicalRecovery,
      `request:${validation.code}`,
      {
        request,
        providerMetadata,
      },
    );
  }

  let providerResult: unknown;
  const providerStart = Date.now();
  try {
    providerResult = await provider(request);
  } catch {
    return fallbackRun(
      trace,
      profiles,
      mechanicalRecovery,
      'provider_exception',
      {
        request,
        latencyMs: Date.now() - providerStart,
        providerMetadata,
      },
    );
  }
  const latencyMs = Date.now() - providerStart;

  const parsed = parseProviderEnvelope(providerResult);
  if (parsed.kind === 'invalid') {
    return fallbackRun(
      trace,
      profiles,
      mechanicalRecovery,
      'provider_envelope_invalid',
      {
        request,
        rawResponse: providerResult,
        latencyMs,
        providerMetadata,
      },
    );
  }

  const raw = parsed.kind === 'envelope'
    ? parsed.envelope.mapped_response
    : parsed.response;
  const effectiveMetadata = parsed.kind === 'envelope'
    ? parsed.envelope.provider_metadata
    : providerMetadata;

  const reassembled = reassembleSemanticObservationsV2(
    request.request_id,
    request.candidate_views.map((candidate) => candidate.candidate_id),
    raw,
  );
  if (reassembled.kind === 'PRISTINE_FALLBACK') {
    return fallbackRun(
      trace,
      profiles,
      mechanicalRecovery,
      `reassembly:${reassembled.code}`,
      {
        request,
        rawResponse: providerResult,
        latencyMs,
        providerMetadata: effectiveMetadata,
      },
    );
  }

  const byID = new Map(
    reassembled.observations.map((observation) => [
      observation.candidate_id,
      observation,
    ]),
  );

  const recoveryByID = new Map(
    mechanicalRecovery.map((evidence) => [
      evidence.candidate_id,
      evidence,
    ]),
  );

  const policyResults = Object.freeze(
    trace.candidates.map((candidate) => {
      const observation = byID.get(candidate.candidate_id);
      const recovery = recoveryByID.get(candidate.candidate_id);
      if (observation === undefined || recovery === undefined) {
        throw new Error(
          `missing v2 observation/recovery evidence for ${candidate.candidate_id}`,
        );
      }
      return decideSemanticPolicyV2({
        candidate,
        observation,
        recovery,
        thresholds,
      });
    }),
  );

  const policy = Object.freeze(
    policyResults.map((result) => result.decision),
  );
  const presentations = policyResults.map((result) => result.presentation);
  const frozenObservations = freezeObservations(reassembled.observations);
  const observationDigest = sha256Digest(JSON.stringify({
    schema: 'anvil.semantic-fabric-v2-decision-evidence.v0',
    observations: frozenObservations,
    mechanicalRecovery,
    policy,
  }));

  return {
    arm: 'D2',
    presentations,
    observations: frozenObservations,
    mechanicalRecovery,
    policy,
    receipts: [
      makeReceipt(trace, profiles, {
        request,
        rawResponse: providerResult,
        observationDigest,
        dispositions: presentations.map((x) => x.disposition),
        errorCode: null,
        pristineFallback: false,
        latencyMs,
        providerMetadata: effectiveMetadata,
      }),
    ],
  };
}
