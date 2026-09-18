import { createToolRecoveryManifest } from './recovery.js';
import type { ReplayTrace } from './replay.js';

function longStdout(
  prefix: string,
  criticalLine: string | null,
  criticalIndex = 512,
  lineCount = 1024,
): string {
  const lines = Array.from({ length: lineCount }, (_, index) =>
    `${prefix} step=${String(index).padStart(4, '0')} status=ok elapsed_ms=${(index % 97) + 3} artifact=unit-${index % 41}`,
  );
  if (criticalLine !== null) {
    lines[criticalIndex] = criticalLine;
  }
  return lines.join('\n');
}

function trace(
  id: string,
  stdout: string,
  critical: string,
  options: { stderr?: string; exitStatus?: number } = {},
): ReplayTrace {
  const objectID = `${id}-object`;
  const stderr = options.stderr ?? '';
  const exitStatus = options.exitStatus ?? 0;
  return {
    trace_id: id,
    source_run_id: `fixture-${id}`,
    shared_state: 'Continue the engineering task while preserving source-bound evidence.',
    candidates: [{
      candidate_id: 'cand-0001',
      stdout,
      stderr,
      exit_status: exitStatus,
      head_lines: 1,
      tail_lines: 1,
      presentation_budget_bytes: 4096,
      recovery: createToolRecoveryManifest(stdout, stderr, exitStatus, objectID),
      critical_evidence: [critical],
    }],
  };
}

export function dependencyTrapCorpus(): ReplayTrace[] {
  return [
    trace(
      'trap-deprecation-middle',
      longStdout(
        'swift-build',
        'warning: API legacyFoo is deprecated; use modernFoo before macOS 27 rollout',
      ),
      'legacyFoo',
    ),
    trace(
      'trap-memory-address-middle',
      longStdout(
        'asan',
        'heap-use-after-free at 0x7ffee1c0ffee in ANEPlan::dispatch',
        611,
      ),
      '0x7ffee1c0ffee',
    ),
    trace(
      'trap-stderr-warning',
      longStdout('link', null),
      'linker warning: duplicate symbol _ANEPlan',
      { stderr: 'linker warning: duplicate symbol _ANEPlan' },
    ),
    trace(
      'trap-original-failure',
      longStdout(
        'build-retry',
        'FAIL root cause: missing libANE.dylib while resolving runtime dependency',
        333,
      ),
      'missing libANE.dylib',
      { exitStatus: 1 },
    ),
    trace(
      'trap-changed-path',
      longStdout(
        'scan',
        'changed-path: src/generated/changed-contract.ts requires regeneration',
        777,
      ),
      'src/generated/changed-contract.ts',
    ),
    trace(
      'trap-provenance-only',
      longStdout(
        'evidence',
        'provenance: sha256:feedfacecafebeef is the only source-bound receipt anchor',
        444,
      ),
      'sha256:feedfacecafebeef',
    ),
    trace(
      'trap-insufficient-view',
      longStdout(
        'context',
        'constraint: DO_NOT_EDIT_PRODUCTION until independent exact-head review passes',
        701,
      ),
      'DO_NOT_EDIT_PRODUCTION',
    ),
    trace(
      'trap-recovery-mismatch',
      longStdout(
        'recovery',
        'critical: exact recovery must verify before referential presentation',
        256,
      ),
      'exact recovery must verify',
    ),
  ];
}
