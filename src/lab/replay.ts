import { carveHardRoots } from './hard-roots.js';
import type { InMemoryCAS, RecoveryManifest } from './recovery.js';

export interface ReplayCandidate {
  candidate_id: string;
  stdout: string;
  stderr: string;
  exit_status: number;
  head_lines: number;
  tail_lines: number;
  presentation_budget_bytes: number;
  recovery: RecoveryManifest;
  critical_evidence: string[];
}

export interface ReplayTrace {
  trace_id: string;
  source_run_id: string;
  shared_state: string;
  candidates: ReplayCandidate[];
}

export type ReplayDisposition = 'FULL' | 'REFERENTIAL' | 'EVICTED' | 'PRISTINE_FALLBACK';

export interface ReplayPresentation {
  candidate_id: string;
  disposition: ReplayDisposition;
  visible_text: string;
  source_digest: string;
  omitted_bytes: number;
  recovery_required: boolean;
}

export interface ReplayRun {
  arm: string;
  presentations: ReplayPresentation[];
}

export function evidenceMarker(candidate: ReplayCandidate, omittedBytes: number): string {
  return `[sieve-evidence source=${candidate.recovery.source_digest} recovery=${candidate.recovery.recovery_ref} omitted_bytes=${omittedBytes}]`;
}

export function fullPresentation(candidate: ReplayCandidate, disposition: ReplayDisposition = 'FULL'): ReplayPresentation {
  const combined = [candidate.stdout, candidate.stderr].filter((value) => value.length > 0).join('\n');
  return {
    candidate_id: candidate.candidate_id,
    disposition,
    visible_text: combined,
    source_digest: candidate.recovery.source_digest,
    omitted_bytes: 0,
    recovery_required: false,
  };
}

export function referentialPresentation(candidate: ReplayCandidate): ReplayPresentation {
  const carved = carveHardRoots({
    exitStatus: candidate.exit_status,
    stdout: candidate.stdout,
    stderr: candidate.stderr,
    headLines: candidate.head_lines,
    tailLines: candidate.tail_lines,
    presentationBudgetBytes: candidate.presentation_budget_bytes,
  });
  if (carved.kind === 'PRISTINE') {
    return fullPresentation(candidate);
  }

  const lines = [
    ...carved.hardRoots.first_lines,
    ...carved.hardRoots.stderr,
    ...carved.hardRoots.last_lines,
    evidenceMarker(candidate, carved.omitted_stdout_bytes),
  ];
  return {
    candidate_id: candidate.candidate_id,
    disposition: carved.omitted_stdout_bytes > 0 ? 'REFERENTIAL' : 'FULL',
    visible_text: lines.join('\n'),
    source_digest: candidate.recovery.source_digest,
    omitted_bytes: carved.omitted_stdout_bytes,
    recovery_required: carved.omitted_stdout_bytes > 0,
  };
}

export function runPristineArm(trace: ReplayTrace, _cas: InMemoryCAS): ReplayRun {
  return {
    arm: 'A',
    presentations: trace.candidates.map((candidate) => fullPresentation(candidate)),
  };
}

export function runDeterministicArm(trace: ReplayTrace, cas: InMemoryCAS): ReplayRun {
  return {
    arm: 'B',
    presentations: trace.candidates.map((candidate) => {
      if (!cas.verifyTool(
        candidate.recovery,
        candidate.stdout,
        candidate.stderr,
        candidate.exit_status,
      ).ok) {
        return fullPresentation(candidate);
      }
      return referentialPresentation(candidate);
    }),
  };
}
