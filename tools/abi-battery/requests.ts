// requests.ts — canonical request construction for the ABI battery.
//
// Requests are produced by the SAME code path the canonical observation arm
// uses: carveHardRoots -> runObservationOnlyArm's internal buildRequest,
// captured through the provider callback. Nothing here re-implements the
// contract; a capture provider simply receives the built request.

import { runObservationOnlyArm, type ObservationProfiles } from '../../src/lab/observation-arm.js';
import { encodeToolEvidence, InMemoryCAS } from '../../src/lab/recovery.js';
import type { ReplayTrace } from '../../src/lab/replay.js';
import {
  MAPPED_DECISION_RESPONSE_SCHEMA,
  type MappedDecisionRequest,
} from '../../src/lab/types.js';

const OPEN_THRESHOLDS = { evidenceSufficientFloor: 0, keepFull: 2, retain: 2 };

export function casForTraces(traces: readonly ReplayTrace[]): InMemoryCAS {
  const cas = new InMemoryCAS();
  for (const trace of traces) {
    for (const candidate of trace.candidates) {
      cas.put(
        candidate.recovery.recovery_ref.slice(4),
        encodeToolEvidence(candidate.stdout, candidate.stderr, candidate.exit_status),
      );
    }
  }
  return cas;
}

function captureResponse(request: MappedDecisionRequest) {
  return {
    schema: MAPPED_DECISION_RESPONSE_SCHEMA,
    request_id: request.request_id,
    observations: request.candidate_views.map((candidate) => ({
      candidate_id: candidate.candidate_id,
      evidence_sufficient: { noul: 0.5 },
      still_needed: { noul: 0.5 },
      full_content_needed: { noul: 0.5 },
      unresolved_evidence: { noul: 0.5 },
      recoverable: { noul: 0.5 },
    })),
  };
}

// Captures the exact MappedDecisionRequest the canonical arm would send.
// Fails closed if the arm cannot construct one (pristine fallback path).
export async function captureCanonicalRequest(
  trace: ReplayTrace,
  profiles: ObservationProfiles,
): Promise<MappedDecisionRequest> {
  let captured: MappedDecisionRequest | undefined;
  await runObservationOnlyArm(
    trace,
    casForTraces([trace]),
    profiles,
    OPEN_THRESHOLDS,
    (request) => {
      captured = request;
      return captureResponse(request);
    },
  );
  if (captured === undefined) {
    throw new Error(`trace ${trace.trace_id} produced no canonical request (pristine fallback)`);
  }
  return captured;
}

// Builds a synthetic merged trace (batch composition variant) whose canonical
// request carries every listed candidate under one request_id.
export function mergedTrace(
  batchId: string,
  traces: readonly ReplayTrace[],
): ReplayTrace {
  const candidates = traces.flatMap((trace) => trace.candidates);
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (ids.has(candidate.candidate_id)) {
      throw new Error(`duplicate candidate ${candidate.candidate_id} in merged batch ${batchId}`);
    }
    ids.add(candidate.candidate_id);
  }
  if (candidates.length === 0 || candidates.length > 64) {
    throw new Error(`merged batch ${batchId} candidate count out of contract (1..64)`);
  }
  return {
    trace_id: batchId,
    source_run_id: `fixture-abi-battery-${batchId}`,
    shared_state: 'Continue the engineering task while preserving source-bound evidence.',
    candidates,
  };
}

// Rebinds candidate_ids inside a trace so the canonical lexical sort places
// candidates at different positions. Mapping is returned for analysis;
// source_digest identity is untouched.
export function permuteCandidateIds(
  trace: ReplayTrace,
  orderedNewIds: readonly string[],
): { trace: ReplayTrace; idMap: Record<string, string> } {
  if (orderedNewIds.length !== trace.candidates.length) {
    throw new Error('permutation id count must equal candidate count');
  }
  const idMap: Record<string, string> = {};
  const candidates = trace.candidates.map((candidate, index) => {
    const newId = orderedNewIds[index];
    idMap[newId] = candidate.candidate_id;
    return { ...candidate, candidate_id: newId };
  });
  return {
    trace: { ...trace, trace_id: `${trace.trace_id}-perm`, candidates },
    idMap,
  };
}
