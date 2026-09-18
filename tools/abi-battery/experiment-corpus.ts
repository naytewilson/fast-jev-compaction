// experiment-corpus.ts — frozen synthetic-fixture corpus for the semantic
// ABI calibration battery.
//
// Construction mirrors src/lab/campaign-corpus.ts (deterministic, source-
// bound). Labels are computed from constructed ground truth by the SAME
// mechanical rules as mechanicalLabelTargets — label authority is
// STRONG-by-construction within synthetic-fixture scope, never author
// assertion. source_run_id carries the fixture- prefix the egress boundary
// requires.
//
// Construction factors (contradiction, completeness, obsoleteKind, ...) are
// recorded per candidate as independent variables for factorial analysis —
// they are NOT label inputs; labels come only from the uniform mechanical
// rule applied to the constructed bytes.

import {
  createToolRecoveryManifest,
  encodeToolEvidence,
  sha256Digest,
} from '../../src/lab/recovery.js';
import { mechanicalLabelTargets, MECHANICAL_VERIFIER_ID } from '../../src/lab/campaign-corpus.js';
import type { ReplayTrace, ReplayCandidate } from '../../src/lab/replay.js';
import type { SemanticCalibrationLabel } from '../../src/lab/semantic-label.js';
import type { Digest256 } from '../../src/lab/identity.js';
import {
  MAPPED_OBSERVATION_AXES,
  type MappedObservationAxis,
} from '../../src/lab/types.js';

export const EXPERIMENT_CORPUS_ID = 'anvil.abi-battery-corpus.v1';
export const EXPERIMENT_VERIFIER_ID = 'anvil.mechanical-experiment-constructor.v1';

export type Placement = 'head' | 'tail' | 'middle' | 'absent';
export type ObsoleteKind =
  | 'obsolete-log'
  | 'completed-task'
  | 'superseded-config'
  | 'duplicate'
  | 'unrelated-plausible'
  | 'stale-generation'
  | 'earlier-mission'
  | 'resolved-historical';
export type UnresolvedKind = 'warning' | 'dependency' | 'verification' | 'resolved-historical';

export interface ExperimentSpec {
  id: string;
  wave: 'base' | 'factorial' | 'hardneg';
  placement: Placement;
  stderr: 'none' | 'warning' | 'error';
  exitStatus: number;
  lineCount: number;
  criticalMarker: string | null;
  contradiction: boolean;
  obsoleteKind: ObsoleteKind | null;
  unresolvedKind: UnresolvedKind | null;
  recoveryIntact: boolean;
  duplicateOf: string | null;
  resolvedHistorically: boolean;
}

export interface CorpusEntry {
  spec: ExperimentSpec;
  trace: ReplayTrace;
  targets: Record<MappedObservationAxis, 0 | 1>;
}

function fillerLines(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    `${prefix} step=${String(i).padStart(4, '0')} status=ok elapsed_ms=${(i % 97) + 3} artifact=unit-${i % 41}`);
}

function buildStdout(spec: ExperimentSpec): string {
  const headLines = 8;
  const tailLines = 8;
  const lines = fillerLines(`job-${spec.id}`, spec.lineCount);

  // Obsolete-flavor surface text: keeps regex-free for clean negatives unless
  // the construction intends unresolved markers.
  if (spec.obsoleteKind === 'obsolete-log') {
    lines[0] = `[2025-11-02T03:14:00Z] archived run ${spec.id} (superseded schedule)`;
  } else if (spec.obsoleteKind === 'completed-task') {
    lines[0] = `task ${spec.id} completed successfully; all checkpoints written`;
  } else if (spec.obsoleteKind === 'superseded-config') {
    lines[0] = `config generation=5 SUPERSEDED by generation=7 for ${spec.id}`;
    lines[1] = `deprecated parameter block retained for audit only`;
  } else if (spec.obsoleteKind === 'unrelated-plausible') {
    lines[0] = `inventory: node fan tachometer rpm=2100 voltage=12.03 temp_c=41`;
    lines[1] = `inventory: ssd wear_level=4% smart_status=pass nominal`;
  } else if (spec.obsoleteKind === 'stale-generation') {
    lines[0] = `generation=3 snapshot for ${spec.id} (active generation=7)`;
  } else if (spec.obsoleteKind === 'earlier-mission') {
    lines[0] = `mission=edge-bringup-2025 (closed) ${spec.id} deliverables archived`;
  } else if (spec.obsoleteKind === 'resolved-historical') {
    lines[0] = `error: unit ${spec.id} failed verification at step=0003`;
    lines[1] = `resolution: root cause isolated, fix landed, verified RESOLVED`;
  }

  if (spec.unresolvedKind === 'dependency') {
    lines[2] = `dependency pending: artifact unit-17 blocked on upstream build ${spec.id}`;
  } else if (spec.unresolvedKind === 'verification') {
    lines[2] = `verification pending: signature check not yet executed for ${spec.id}`;
  } else if (spec.unresolvedKind === 'resolved-historical') {
    lines[2] = `error: historical failure at step=0002 RESOLVED by hotfix ${spec.id}`;
  }

  if (spec.contradiction) {
    // Injected into the tail region so the contradiction is inside the carved
    // view the provider observes — a hidden contradiction would measure view
    // sufficiency, not predicate semantics.
    lines[spec.lineCount - 3] = `verification PASSED for ${spec.id} (self-check)`;
    lines[spec.lineCount - 2] = `verification FAILED for ${spec.id} (auditor re-check)`;
  }

  if (spec.criticalMarker !== null && spec.placement !== 'absent') {
    const marker = `CRITICAL ${spec.criticalMarker}`;
    const idx =
      spec.placement === 'head' ? 0 :
      spec.placement === 'tail' ? spec.lineCount - 1 :
      Math.floor(spec.lineCount / 2);
    lines[idx] = `${marker} at step=${idx}`;
  }
  return lines.join('\n');
}

function buildCandidate(spec: ExperimentSpec, duplicateStdout?: string): ReplayCandidate {
  const stdout = spec.duplicateOf !== null && duplicateStdout !== undefined
    ? duplicateStdout
    : buildStdout(spec);
  const stderr =
    spec.stderr === 'none' ? '' :
    spec.stderr === 'warning' ? `warning: recovered unit referenced deprecated symbol for ${spec.id}` :
    `error: unit ${spec.id} reported a non-fatal verification mismatch`;
  const manifest = createToolRecoveryManifest(stdout, stderr, spec.exitStatus, `${spec.id}-object`);
  const recovery = spec.recoveryIntact
    ? manifest
    : { ...manifest, byte_count: Math.max(1, Math.floor(manifest.byte_count / 997)) };
  const criticalEvidence =
    spec.criticalMarker === null || spec.placement === 'absent' ? [] : [`CRITICAL ${spec.criticalMarker}`];
  return {
    candidate_id: `cand-${spec.id}`,
    stdout,
    stderr,
    exit_status: spec.exitStatus,
    head_lines: 8,
    tail_lines: 8,
    presentation_budget_bytes: 2048,
    recovery,
    critical_evidence: criticalEvidence,
  };
}

function spec(partial: Partial<ExperimentSpec> & { id: string }): ExperimentSpec {
  return {
    wave: 'base',
    placement: 'absent',
    stderr: 'none',
    exitStatus: 0,
    lineCount: 200,
    criticalMarker: null,
    contradiction: false,
    obsoleteKind: null,
    unresolvedKind: null,
    recoveryIntact: true,
    duplicateOf: null,
    resolvedHistorically: false,
    ...partial,
  };
}

export function experimentSpecs(): readonly ExperimentSpec[] {
  const specs: ExperimentSpec[] = [];
  const placements: Placement[] = ['head', 'tail', 'middle', 'absent'];
  const stderrs: ExperimentSpec['stderr'][] = ['none', 'warning', 'error'];
  let n = 0;

  // Base matrix: identical structure to campaignCorpus (comparable surface).
  for (const placement of placements) {
    for (const se of stderrs) {
      for (const size of [64, 400]) {
        specs.push(spec({
          id: `ab-${String(n).padStart(3, '0')}`,
          placement,
          stderr: se,
          exitStatus: se === 'error' ? 1 : 0,
          lineCount: size,
          criticalMarker: `marker-${n}`,
        }));
        n += 1;
      }
    }
  }
  // Recovery-damaged variants.
  for (const placement of ['head', 'middle'] as const) {
    specs.push(spec({
      id: `ab-${String(n).padStart(3, '0')}`,
      placement,
      lineCount: 200,
      criticalMarker: `marker-${n}`,
      recoveryIntact: false,
    }));
    n += 1;
  }
  // Balance top-up: more omitted-critical (evidence_sufficient=0) and
  // absent-critical controls (evidence_sufficient=1, still_needed=0).
  // The label space is triangular: ES=0 requires omitted critical evidence
  // (implies SN=1) and SN=0 requires no critical marker (implies ES=1), so
  // the (0,0) cell is unreachable — middle and absent counts are pushed up
  // together to approach balance on both axes simultaneously.
  for (let i = 0; i < 42; i++) {
    specs.push(spec({
      id: `ab-${String(n).padStart(3, '0')}`,
      placement: 'middle',
      stderr: i % 2 === 0 ? 'warning' : 'none',
      exitStatus: 0,
      lineCount: i % 3 === 0 ? 200 : 400,
      criticalMarker: `marker-${n}`,
    }));
    n += 1;
  }
  for (let i = 0; i < 12; i++) {
    specs.push(spec({
      id: `ab-${String(n).padStart(3, '0')}`,
      placement: 'absent',
      stderr: i % 3 === 0 ? 'warning' : 'none',
      exitStatus: 0,
      lineCount: 400,
      criticalMarker: null,
    }));
    n += 1;
  }

  // Wave D factorial: completeness × contradiction, 4 cells × 6.
  const factorialCells: { complete: boolean; contra: boolean }[] = [
    { complete: true, contra: false },
    { complete: true, contra: true },
    { complete: false, contra: false },
    { complete: false, contra: true },
  ];
  for (const cell of factorialCells) {
    for (let i = 0; i < 6; i++) {
      specs.push(spec({
        id: `fd-${String(n).padStart(3, '0')}`,
        wave: 'factorial',
        placement: cell.complete ? 'head' : 'middle',
        stderr: 'none',
        exitStatus: 0,
        lineCount: 300,
        criticalMarker: `marker-${n}`,
        contradiction: cell.contra,
      }));
      n += 1;
    }
  }
  // Unresolved-kind variants: warning / dependency / verification /
  // resolved-historical (4 each) — all complete-view, no contradiction.
  const unresolvedKinds: UnresolvedKind[] = ['warning', 'dependency', 'verification', 'resolved-historical'];
  for (const kind of unresolvedKinds) {
    for (let i = 0; i < 4; i++) {
      specs.push(spec({
        id: `fd-${String(n).padStart(3, '0')}`,
        wave: 'factorial',
        placement: 'head',
        stderr: kind === 'warning' ? 'warning' : 'none',
        exitStatus: 0,
        lineCount: 300,
        criticalMarker: `marker-${n}`,
        unresolvedKind: kind,
        resolvedHistorically: kind === 'resolved-historical',
      }));
      n += 1;
    }
  }

  // Wave E hard negatives: 7 kinds × 6 + duplicate pair. All carry no
  // critical marker → still_needed=0 mechanically; surface realism varies.
  const negKinds: ObsoleteKind[] = [
    'obsolete-log', 'completed-task', 'superseded-config', 'unrelated-plausible',
    'stale-generation', 'earlier-mission', 'resolved-historical',
  ];
  for (const kind of negKinds) {
    for (let i = 0; i < 6; i++) {
      specs.push(spec({
        id: `hn-${String(n).padStart(3, '0')}`,
        wave: 'hardneg',
        placement: 'absent',
        stderr: 'none',
        exitStatus: 0,
        lineCount: 200,
        criticalMarker: null,
        obsoleteKind: kind,
        resolvedHistorically: kind === 'resolved-historical',
      }));
      n += 1;
    }
  }
  // Duplicate pair: cand-hn-dup-src holds a critical marker (still_needed=1);
  // cand-hn-dup-copy is byte-identical content under a second candidate id.
  specs.push(spec({
    id: `hn-${String(n).padStart(3, '0')}`,
    wave: 'hardneg',
    placement: 'head',
    lineCount: 200,
    criticalMarker: `marker-${n}`,
    obsoleteKind: 'duplicate',
  }));
  const dupSourceId = `hn-${String(n).padStart(3, '0')}`;
  n += 1;
  specs.push(spec({
    id: `hn-${String(n).padStart(3, '0')}`,
    wave: 'hardneg',
    placement: 'head',
    lineCount: 200,
    criticalMarker: `marker-${n - 1}`,
    obsoleteKind: 'duplicate',
    duplicateOf: dupSourceId,
  }));
  n += 1;

  return specs;
}

const FAILURE_CLASS_TEXT = /FAIL|error|warning|deprecated|use-after-free/i;

// unresolved_evidence = construction ground truth, stronger than the
// campaign regex proxy: exit != 0 OR stderr present OR injected
// contradiction OR constructed pending dependency/verification OR
// failure-class source text that is not resolved-historical.
function unresolvedTruth(candidate: ReplayCandidate, spec: ExperimentSpec): 0 | 1 {
  if (candidate.exit_status !== 0) return 1;
  if (candidate.stderr.length > 0) return 1;
  if (spec.contradiction) return 1;
  if (spec.unresolvedKind === 'dependency' || spec.unresolvedKind === 'verification') return 1;
  if (FAILURE_CLASS_TEXT.test(candidate.stdout) && !spec.resolvedHistorically) return 1;
  return 0;
}

export function experimentTargets(
  candidate: ReplayCandidate,
  spec: ExperimentSpec,
): Record<MappedObservationAxis, 0 | 1> {
  const base = mechanicalLabelTargets(candidate);
  return { ...base, unresolved_evidence: unresolvedTruth(candidate, spec) };
}

export function buildExperimentCorpus(): readonly CorpusEntry[] {
  const specs = experimentSpecs();
  const entries: CorpusEntry[] = [];
  const byId = new Map<string, ReplayCandidate>();

  for (const s of specs) {
    const dupSource = s.duplicateOf !== null ? byId.get(s.duplicateOf) : undefined;
    const candidate = buildCandidate(s, dupSource?.stdout);
    // Duplicate carries a dedup notation line appended — distinct digest,
    // semantically duplicate payload, no sourceDigest collision.
    if (s.duplicateOf !== null && dupSource !== undefined) {
      candidate.stdout = `${dupSource.stdout}\n// duplicate-of ${s.duplicateOf} (payload above is byte-identical)`;
      const manifest = createToolRecoveryManifest(candidate.stdout, candidate.stderr, candidate.exit_status, `${s.id}-object`);
      candidate.recovery = manifest;
      candidate.critical_evidence = dupSource.critical_evidence;
    }
    byId.set(s.id, candidate);
    const trace: ReplayTrace = {
      trace_id: s.id,
      source_run_id: `fixture-abi-battery-${s.id}`,
      shared_state: 'Continue the engineering task while preserving source-bound evidence.',
      candidates: [candidate],
    };
    entries.push({ spec: s, trace, targets: experimentTargets(candidate, s) });
  }
  return entries;
}

export function mintExperimentLabels(input: {
  entries: readonly CorpusEntry[];
  decisionContractDigest: Digest256;
  labelBindingDigest: Digest256;
}): readonly SemanticCalibrationLabel[] {
  const labels: SemanticCalibrationLabel[] = [];
  for (const entry of input.entries) {
    const candidate = entry.trace.candidates[0];
    const outcomeDigest = sha256Digest(JSON.stringify({
      schema: 'anvil.abi-battery-outcome.v1',
      traceId: entry.trace.trace_id,
      candidateId: candidate.candidate_id,
      sourceDigest: candidate.recovery.source_digest,
      targets: entry.targets,
      construction: {
        wave: entry.spec.wave,
        placement: entry.spec.placement,
        contradiction: entry.spec.contradiction,
        obsoleteKind: entry.spec.obsoleteKind,
        unresolvedKind: entry.spec.unresolvedKind,
        recoveryIntact: entry.spec.recoveryIntact,
        resolvedHistorically: entry.spec.resolvedHistorically,
      },
    }));
    for (const predicateId of MAPPED_OBSERVATION_AXES) {
      labels.push({
        labelId: `${entry.trace.trace_id}:${candidate.candidate_id}:${predicateId}`,
        authority: 'STRONG',
        decisionContractDigest: input.decisionContractDigest,
        predicateId,
        labelBindingDigest: input.labelBindingDigest,
        sourceDigest: candidate.recovery.source_digest,
        outcomeDigest,
        target: entry.targets[predicateId],
        verifierIdentity: EXPERIMENT_VERIFIER_ID,
      });
    }
  }
  return labels;
}
