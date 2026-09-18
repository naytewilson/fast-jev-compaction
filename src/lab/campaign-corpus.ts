import type { Digest256 } from './identity.js';
import {
  createToolRecoveryManifest,
  encodeToolEvidence,
  sha256Digest,
} from './recovery.js';
import type { ReplayTrace } from './replay.js';
import type { SemanticCalibrationLabel } from './semantic-label.js';
import {
  MAPPED_OBSERVATION_AXES,
  type MappedObservationAxis,
} from './types.js';

// Campaign corpus: deterministic, source-bound replay traces whose label
// targets are COMPUTED from constructed ground truth — never hand-asserted.
// Scope is synthetic-fixture; the mechanical verifier records that fact in
// verifierIdentity so downstream artifacts cannot overstate provenance.

export const CAMPAIGN_CORPUS_ID = 'anvil.campaign-corpus.v1';
export const MECHANICAL_VERIFIER_ID = 'anvil.mechanical-source-verifier.v1';

export type CriticalPlacement =
  | 'head'
  | 'tail'
  | 'middle'
  | 'absent';

export interface CampaignTraceSpec {
  id: string;
  placement: CriticalPlacement;
  stderr: 'none' | 'warning' | 'error';
  exitStatus: number;
  lineCount: number;
  criticalMarker: string;
  recoveryIntact: boolean;
}

function longStdout(
  prefix: string,
  placement: CriticalPlacement,
  criticalMarker: string,
  lineCount: number,
  headLines: number,
  tailLines: number,
): string {
  const lines = Array.from({ length: lineCount }, (_, index) =>
    `${prefix} step=${String(index).padStart(4, '0')} status=ok elapsed_ms=${(index % 97) + 3} artifact=unit-${index % 41}`,
  );
  const put = (i: number) => {
    lines[i] = `CRITICAL ${criticalMarker} at step=${i}`;
  };
  if (placement === 'head') put(Math.min(headLines, 0));
  else if (placement === 'tail') put(lineCount - Math.max(tailLines, 1));
  else if (placement === 'middle') put(Math.floor(lineCount / 2));
  return lines.join('\n');
}

function buildTrace(spec: CampaignTraceSpec): ReplayTrace {
  const headLines = 8;
  const tailLines = 8;
  const stderr =
    spec.stderr === 'none'
      ? ''
      : spec.stderr === 'warning'
        ? `warning: recovered unit referenced deprecated symbol for ${spec.id}`
        : `error: unit ${spec.id} reported a non-fatal verification mismatch`;
  const stdout = longStdout(
    `job-${spec.id}`,
    spec.placement,
    spec.criticalMarker,
    spec.lineCount,
    headLines,
    tailLines,
  );
  const manifest = createToolRecoveryManifest(
    stdout,
    stderr,
    spec.exitStatus,
    `${spec.id}-object`,
  );
  // Damaged case: CAS ref stays well-formed (the request can still be
  // presented) but the declared byte_count is inconsistent with the actual
  // source — the declared identity does not describe this content, so the
  // candidate is not semantically recoverable through it.
  const recovery = spec.recoveryIntact
    ? manifest
    : { ...manifest, byte_count: Math.max(1, Math.floor(manifest.byte_count / 997)) };
  const criticalEvidence =
    spec.placement === 'absent' ? [] : [`CRITICAL ${spec.criticalMarker}`];
  return {
    trace_id: spec.id,
    source_run_id: `campaign-${spec.id}`,
    shared_state: 'Continue the engineering task while preserving source-bound evidence.',
    candidates: [{
      candidate_id: `cand-${spec.id}-0001`,
      stdout,
      stderr,
      exit_status: spec.exitStatus,
      head_lines: headLines,
      tail_lines: tailLines,
      presentation_budget_bytes: 2048,
      recovery,
      critical_evidence: criticalEvidence,
    }],
  };
}

export function campaignCorpus(): readonly ReplayTrace[] {
  const specs: CampaignTraceSpec[] = [];
  const placements: CriticalPlacement[] = ['head', 'tail', 'middle', 'absent'];
  const stderrs: CampaignTraceSpec['stderr'][] = ['none', 'warning', 'error'];
  let n = 0;
  for (const placement of placements) {
    for (const stderr of stderrs) {
      for (const size of [64, 400]) {
        specs.push({
          id: `ct-${String(n).padStart(2, '0')}`,
          placement,
          stderr,
          exitStatus: stderr === 'error' ? 1 : 0,
          lineCount: size,
          criticalMarker: `marker-${n}`,
          recoveryIntact: true,
        });
        n += 1;
      }
    }
  }
  // Recovery-damaged variants: declared identity exists but is not verifiable.
  for (const placement of ['head', 'middle'] as const) {
    specs.push({
      id: `ct-${String(n).padStart(2, '0')}`,
      placement,
      stderr: 'none',
      exitStatus: 0,
      lineCount: 200,
      criticalMarker: `marker-${n}`,
      recoveryIntact: false,
    });
    n += 1;
  }
  return specs.map(buildTrace);
}

// ---------------------------------------------------------------------------
// Mechanical labels. Each predicate target is a pure function of the trace's
// constructed ground truth plus the carved semantic view actually shown to
// providers (head_lines/tail_lines budgeted presentation).
// ---------------------------------------------------------------------------

function retainedViewLines(candidate: ReplayTrace['candidates'][number]): string[] {
  const lines = candidate.stdout.split('\n');
  const head = lines.slice(0, candidate.head_lines);
  const tail = lines.slice(-candidate.tail_lines);
  return [...head, ...tail];
}

function criticalInView(candidate: ReplayTrace['candidates'][number]): boolean {
  if (candidate.critical_evidence.length === 0) return false;
  const view = retainedViewLines(candidate).join('\n');
  return candidate.critical_evidence.every((crit) => view.includes(crit));
}

function criticalInSource(candidate: ReplayTrace['candidates'][number]): boolean {
  if (candidate.critical_evidence.length === 0) return false;
  return candidate.critical_evidence.every((crit) => candidate.stdout.includes(crit));
}

function omittedContainsCritical(candidate: ReplayTrace['candidates'][number]): boolean {
  return criticalInSource(candidate) && !criticalInView(candidate);
}

export function mechanicalLabelTargets(
  candidate: ReplayTrace['candidates'][number],
): Record<MappedObservationAxis, 0 | 1> {
  // stderr and exit_status are always surfaced through hard_roots, so they
  // never reduce view sufficiency; only omitted critical evidence does.
  const viewSufficient =
    candidate.critical_evidence.length === 0 ? 1 : criticalInView(candidate) ? 1 : 0;
  const hasUnresolved =
    candidate.exit_status !== 0 ||
    candidate.stderr.length > 0 ||
    /FAIL|error|warning|deprecated|use-after-free/i.test(candidate.stdout);
  const actualBytes = Buffer.byteLength(
    encodeToolEvidence(candidate.stdout, candidate.stderr, candidate.exit_status),
    'utf8',
  );
  const recoveryDeclared =
    typeof candidate.recovery === 'object' &&
    candidate.recovery !== null &&
    typeof (candidate.recovery as { recovery_ref?: unknown }).recovery_ref === 'string' &&
    String((candidate.recovery as { recovery_ref?: unknown }).recovery_ref).startsWith('cas:') &&
    (candidate.recovery as { byte_count?: unknown }).byte_count === actualBytes;
  return {
    // The bounded view shown to the provider carries the decisive evidence.
    evidence_sufficient: viewSufficient as 0 | 1,
    // Source contains mission-relevant information at all.
    still_needed: criticalInSource(candidate) ? 1 : 0,
    // Decisive evidence was omitted by presentation carving.
    full_content_needed: omittedContainsCritical(candidate) ? 1 : 0,
    // Failure/warning/contradiction evidence exists in source.
    unresolved_evidence: hasUnresolved ? 1 : 0,
    // Declared identity is structurally recoverable.
    recoverable: recoveryDeclared ? 1 : 0,
  };
}

export function mintCampaignLabels(input: {
  traces: readonly ReplayTrace[];
  decisionContractDigest: Digest256;
  labelBindingDigest: Digest256;
}): readonly SemanticCalibrationLabel[] {
  const labels: SemanticCalibrationLabel[] = [];
  for (const trace of input.traces) {
    for (const candidate of trace.candidates) {
      const targets = mechanicalLabelTargets(candidate);
      const outcomeDigest = sha256Digest(JSON.stringify({
        schema: 'anvil.campaign-outcome.v1',
        traceId: trace.trace_id,
        candidateId: candidate.candidate_id,
        sourceDigest: candidate.recovery.source_digest,
        targets,
      }));
      for (const predicateId of MAPPED_OBSERVATION_AXES) {
        labels.push({
          labelId: `${trace.trace_id}:${candidate.candidate_id}:${predicateId}`,
          authority: 'STRONG',
          decisionContractDigest: input.decisionContractDigest,
          predicateId,
          labelBindingDigest: input.labelBindingDigest,
          sourceDigest: candidate.recovery.source_digest,
          outcomeDigest,
          target: targets[predicateId],
          verifierIdentity: MECHANICAL_VERIFIER_ID,
        });
      }
    }
  }
  return labels;
}

// Deterministic split: trace_id digest parity — reproducible across workers.
export function splitCampaignCorpus(
  traces: readonly ReplayTrace[],
): { training: ReplayTrace[]; holdout: ReplayTrace[] } {
  const training: ReplayTrace[] = [];
  const holdout: ReplayTrace[] = [];
  for (const trace of traces) {
    const hex = sha256Digest(trace.trace_id).slice('sha256:'.length);
    (parseInt(hex[0], 16) % 2 === 0 ? training : holdout).push(trace);
  }
  return { training, holdout };
}
