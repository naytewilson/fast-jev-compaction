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
import { createReplayReceipt, type ReplayReceipt } from './receipt.js';
import { sha256Digest, type InMemoryCAS } from './recovery.js';
import type {
  MappedDecisionRequest,
  MappedDecisionResponse,
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

export type MappedObservationProvider = (
  request: MappedDecisionRequest,
) => Promise<unknown> | unknown;

export type ObservationReplayRun = ReplayRun & {
  receipts: ReplayReceipt[];
};

function buildRequest(trace: ReplayTrace, profiles: ObservationProfiles): MappedDecisionRequest {
  const candidate_views = [...trace.candidates]
    .sort((a, b) => a.candidate_id.localeCompare(b.candidate_id))
    .map((candidate) => ({
      candidate_id: candidate.candidate_id,
      source_digest: candidate.recovery.source_digest,
      source_kind: 'tool_result' as const,
      recovery_ref: candidate.recovery.recovery_ref,
      byte_count: candidate.recovery.byte_count,
      hard_roots: {
        exit_status: candidate.exit_status,
        stderr: candidate.stderr.length ? candidate.stderr.split('\n') : [],
        first_lines: candidate.stdout.split('\n').slice(0, candidate.head_lines),
        last_lines: candidate.stdout.split('\n').slice(-candidate.tail_lines),
      },
      semantic_view: {
        head: candidate.stdout.split('\n').slice(0, candidate.head_lines).join('\n'),
        tail: candidate.stdout.split('\n').slice(-candidate.tail_lines).join('\n'),
        selected_chunks: [],
        omitted_bytes: Math.max(
          0,
          candidate.recovery.byte_count -
            Buffer.byteLength(
              candidate.stdout.split('\n').slice(0, candidate.head_lines).join('\n') +
                candidate.stdout.split('\n').slice(-candidate.tail_lines).join('\n'),
              'utf8',
            ),
        ),
      },
    }));

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

function candidateSetDigest(trace: ReplayTrace): string {
  return sha256Digest(JSON.stringify(
    trace.candidates.map((candidate) => ({
      candidate_id: candidate.candidate_id,
      source_digest: candidate.recovery.source_digest,
      recovery_ref: candidate.recovery.recovery_ref,
    })),
  ));
}

function makeReceipt(
  trace: ReplayTrace,
  profiles: ObservationProfiles,
  observationDigest: string,
  dispositions: string[],
): ReplayReceipt {
  return createReplayReceipt({
    receipt_schema: 'anvil.semantic-retention-replay-receipt.v0',
    trace_id: trace.trace_id,
    source_run_id: trace.source_run_id,
    arm: 'D',
    decision_contract_digest: profiles.decision_contract.digest,
    execution_profile_digest: profiles.execution_profile.digest,
    calibration_profile_digest: profiles.calibration_profile.digest,
    policy_profile_digest: profiles.policy_profile.digest,
    candidate_set_digest: candidateSetDigest(trace),
    observation_set_digest: observationDigest,
    dispositions,
  });
}

function fallbackRun(
  trace: ReplayTrace,
  profiles: ObservationProfiles,
  reason: string,
): ObservationReplayRun {
  const presentations = trace.candidates.map((candidate) =>
    fullPresentation(candidate, 'PRISTINE_FALLBACK'));
  return {
    arm: 'D',
    presentations,
    receipts: [
      makeReceipt(
        trace,
        profiles,
        sha256Digest(`PRISTINE_FALLBACK:${reason}`),
        presentations.map((presentation) => presentation.disposition),
      ),
    ],
  };
}

export async function runObservationOnlyArm(
  trace: ReplayTrace,
  cas: InMemoryCAS,
  profiles: ObservationProfiles,
  thresholds: ObservationPolicyThresholds,
  provider: MappedObservationProvider,
): Promise<ObservationReplayRun> {
  const request = buildRequest(trace, profiles);
  const validation = validateMappedDecisionRequest(request);
  if (!validation.ok) {
    return fallbackRun(trace, profiles, `request:${validation.code}`);
  }

  let raw: unknown;
  try {
    raw = await provider(request);
  } catch {
    return fallbackRun(trace, profiles, 'provider_exception');
  }

  const reassembled = reassembleMappedObservations(
    request.request_id,
    request.candidate_views.map((candidate) => candidate.candidate_id),
    raw,
  );
  if (reassembled.kind === 'PRISTINE_FALLBACK') {
    return fallbackRun(trace, profiles, `reassembly:${reassembled.code}`);
  }

  const byID = new Map(reassembled.observations.map((observation) => [observation.candidate_id, observation]));
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
  return {
    arm: 'D',
    presentations,
    receipts: [
      makeReceipt(
        trace,
        profiles,
        observationDigest,
        presentations.map((presentation) => presentation.disposition),
      ),
    ],
  };
}

export function observationSetDigest(response: MappedDecisionResponse): string {
  return sha256Digest(JSON.stringify(response.observations));
}
