import { carveHardRoots } from './hard-roots.js';
import {
  validateMappedDecisionRequest,
} from './mapped-contract.js';
import { reassembleMappedObservations } from './reassembler.js';
import {
  fullPresentation,
  referentialPresentation,
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
  MappedDecisionRequest,
  MappedDecisionResponse,
  HardRootEligible,
  ProfileIdentity,
} from './types.js';

export interface ObservationProfiles {
  decision_contract: ProfileIdentity;
  execution_profile: ProfileIdentity;
  calibration_profile: ProfileIdentity;
  policy_profile: ProfileIdentity;
}

export interface ObservationPolicyThresholds {
  evidenceSufficientFloor: number;
  keepFull: number;
  retain: number;
}

export interface ObservationProviderMetadata {
  requested_model?: string;
  effective_model?: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_usd?: number | null;
}

export type MappedObservationProvider = (
  request: MappedDecisionRequest,
) => Promise<unknown> | unknown;

export type ObservationReplayRun = ReplayRun & {
  receipts: ReplayReceipt[];
};

function buildRequest(
  trace: ReplayTrace,
  profiles: ObservationProfiles,
  carvedByID: ReadonlyMap<string, HardRootEligible>,
): MappedDecisionRequest {
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
    schema: 'anvil.mapped-decision-request.v0',
    request_id: `mdr-${trace.trace_id}`,
    source_run_id: trace.source_run_id,
    ...profiles,
    shared_conversation_state: {
      mission: trace.shared_state || 'preserve source-bound evidence',
      recent_turns: [],
      active_constraints: ['semantic observer has no presentation authority'],
      unresolved_failures: [],
      source_refs: trace.candidates.map((candidate) => candidate.recovery.source_digest),
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
    candidates: trace.candidates.map((candidate) => ({
      candidate_id: candidate.candidate_id,
      stdout: candidate.stdout,
      stderr: candidate.stderr,
      exit_status: candidate.exit_status,
      head_lines: candidate.head_lines,
      tail_lines: candidate.tail_lines,
      presentation_budget_bytes: candidate.presentation_budget_bytes,
      recovery: candidate.recovery,
      critical_evidence: candidate.critical_evidence,
    })),
  }, 'invalid-source-trace');
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
    'invalid-candidate-set',
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
  }, 'invalid-hard-root-policy');
}

function recoveryManifestDigest(trace: ReplayTrace): string {
  return digestJSON(
    [...trace.candidates]
      .sort((a, b) => a.candidate_id.localeCompare(b.candidate_id))
      .map((candidate) => ({
        candidate_id: candidate.candidate_id,
        ...candidate.recovery,
      })),
    'invalid-recovery-manifest',
  );
}

type ReceiptContext = {
  request?: MappedDecisionRequest;
  rawResponse?: unknown;
  observationDigest: string;
  dispositions: string[];
  errorCode: string | null;
  pristineFallback: boolean;
  latencyMs: number | null;
  providerMetadata?: ObservationProviderMetadata;
};

function makeReceipt(
  trace: ReplayTrace,
  profiles: ObservationProfiles,
  context: ReceiptContext,
): ReplayReceipt {
  const requestedModel =
    context.providerMetadata?.requested_model ?? profiles.execution_profile.id;
  const effectiveModel =
    context.providerMetadata?.effective_model ?? requestedModel;
  const providerUsage: ReplayProviderUsage = {
    input_tokens: context.providerMetadata?.input_tokens ?? null,
    output_tokens: context.providerMetadata?.output_tokens ?? null,
    cost_usd: context.providerMetadata?.cost_usd ?? null,
  };

  return createReplayReceipt({
    receipt_schema: 'anvil.semantic-retention-replay-receipt.v0',
    trace_id: trace.trace_id,
    source_trace_digest: sourceTraceDigest(trace),
    source_run_id: trace.source_run_id,
    arm: 'D',

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
      ? digestJSON(context.request, 'invalid-provider-request')
      : sha256Digest('NO_PROVIDER_REQUEST'),
    provider_response_digest: context.rawResponse !== undefined
      ? digestJSON(context.rawResponse, 'invalid-provider-response')
      : sha256Digest('NO_PROVIDER_RESPONSE'),
    observation_set_digest: context.observationDigest,
    hard_root_policy_digest: hardRootPolicyDigest(trace),
    recovery_manifest_digest: recoveryManifestDigest(trace),
    policy_dispositions: context.dispositions,
    dispositions: context.dispositions,

    provider_model_requested: requestedModel,
    provider_model_effective: effectiveModel,
    provider_usage: providerUsage,
    latency_ms: context.latencyMs,
    error_code: context.errorCode,
    pristine_fallback: context.pristineFallback,
  });
}

function fallbackRun(
  trace: ReplayTrace,
  profiles: ObservationProfiles,
  reason: string,
  context: Partial<Omit<ReceiptContext, 'observationDigest' | 'dispositions' | 'errorCode' | 'pristineFallback'>> = {},
): ObservationReplayRun {
  const presentations = trace.candidates.map((candidate) =>
    fullPresentation(candidate, 'PRISTINE_FALLBACK'));
  const dispositions = presentations.map((presentation) => presentation.disposition);
  return {
    arm: 'D',
    presentations,
    receipts: [
      makeReceipt(trace, profiles, {
        request: context.request,
        rawResponse: context.rawResponse,
        observationDigest: sha256Digest(`PRISTINE_FALLBACK:${reason}`),
        dispositions,
        errorCode: reason,
        pristineFallback: true,
        latencyMs: context.latencyMs ?? null,
        providerMetadata: context.providerMetadata,
      }),
    ],
  };
}

export async function runObservationOnlyArm(
  trace: ReplayTrace,
  cas: InMemoryCAS,
  profiles: ObservationProfiles,
  thresholds: ObservationPolicyThresholds,
  provider: MappedObservationProvider,
  providerMetadata?: ObservationProviderMetadata,
): Promise<ObservationReplayRun> {
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
      return fallbackRun(trace, profiles, 'hard_roots_exceed_budget', {
        providerMetadata,
      });
    }
    carvedByID.set(candidate.candidate_id, carved);
  }

  const request = buildRequest(trace, profiles, carvedByID);
  const validation = validateMappedDecisionRequest(request);
  if (!validation.ok) {
    return fallbackRun(trace, profiles, `request:${validation.code}`, {
      request,
      providerMetadata,
    });
  }

  let raw: unknown;
  const providerStart = Date.now();
  try {
    raw = await provider(request);
  } catch {
    return fallbackRun(trace, profiles, 'provider_exception', {
      request,
      latencyMs: Date.now() - providerStart,
      providerMetadata,
    });
  }
  const latencyMs = Date.now() - providerStart;

  const reassembled = reassembleMappedObservations(
    request.request_id,
    request.candidate_views.map((candidate) => candidate.candidate_id),
    raw,
  );
  if (reassembled.kind === 'PRISTINE_FALLBACK') {
    return fallbackRun(trace, profiles, `reassembly:${reassembled.code}`, {
      request,
      rawResponse: raw,
      latencyMs,
      providerMetadata,
    });
  }

  const byID = new Map(reassembled.observations.map((observation) => [
    observation.candidate_id,
    observation,
  ]));
  const presentations = trace.candidates.map((candidate) => {
    const observation = byID.get(candidate.candidate_id)!;
    if (observation.evidence_sufficient.noul < thresholds.evidenceSufficientFloor) {
      return fullPresentation(candidate);
    }
    if (observation.unresolved_evidence.noul >= thresholds.keepFull) {
      return fullPresentation(candidate);
    }
    if (!cas.verifyTool(
      candidate.recovery,
      candidate.stdout,
      candidate.stderr,
      candidate.exit_status,
    ).ok) {
      return fullPresentation(candidate);
    }
    if (observation.full_content_needed.noul >= thresholds.keepFull) {
      return fullPresentation(candidate);
    }
    if (observation.still_needed.noul >= thresholds.retain) {
      return referentialPresentation(candidate);
    }
    return {
      candidate_id: candidate.candidate_id,
      disposition: 'EVICTED' as const,
      visible_text: '',
      source_digest: candidate.recovery.source_digest,
      omitted_bytes: candidate.recovery.byte_count,
      recovery_required: true,
    };
  });

  const observationDigest = sha256Digest(JSON.stringify(reassembled.observations));
  const dispositions = presentations.map((presentation) => presentation.disposition);
  return {
    arm: 'D',
    presentations,
    receipts: [
      makeReceipt(trace, profiles, {
        request,
        rawResponse: raw,
        observationDigest,
        dispositions,
        errorCode: null,
        pristineFallback: false,
        latencyMs,
        providerMetadata,
      }),
    ],
  };
}

export function observationSetDigest(response: MappedDecisionResponse): string {
  return sha256Digest(JSON.stringify(response.observations));
}
