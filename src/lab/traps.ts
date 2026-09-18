import { createRecoveryManifest } from './recovery.js';
import type { ReplayTrace } from './replay.js';

function trace(
  id: string,
  stdout: string,
  critical: string,
  options: { stderr?: string; exitStatus?: number } = {},
): ReplayTrace {
  const objectID = `${id}-object`;
  return {
    trace_id: id,
    source_run_id: `run-${id}`,
    shared_state: 'Continue the engineering task while preserving source-bound evidence.',
    candidates: [{
      candidate_id: 'cand-0001',
      stdout,
      stderr: options.stderr ?? '',
      exit_status: options.exitStatus ?? 0,
      head_lines: 1,
      tail_lines: 1,
      presentation_budget_bytes: 4096,
      recovery: createRecoveryManifest(stdout, objectID),
      critical_evidence: [critical],
    }],
  };
}

export function dependencyTrapCorpus(): ReplayTrace[] {
  return [
    trace(
      'trap-deprecation-middle',
      'compile start\nwarning: API legacyFoo is deprecated; use modernFoo\ncompile complete',
      'legacyFoo',
    ),
    trace(
      'trap-memory-address-middle',
      'sanitizer start\nheap-use-after-free at 0x7ffee1c0ffee\nsanitzer summary',
      '0x7ffee1c0ffee',
    ),
    trace(
      'trap-stderr-warning',
      'progress 0%\nprogress 50%\nprogress 100%',
      'linker warning: duplicate symbol _ANEPlan',
      { stderr: 'linker warning: duplicate symbol _ANEPlan' },
    ),
    trace(
      'trap-original-failure',
      'first attempt\nFAIL root cause: missing libANE.dylib\nlater retry succeeded',
      'missing libANE.dylib',
      { exitStatus: 1 },
    ),
    trace(
      'trap-changed-path',
      'src/a.ts\nsrc/generated/changed-contract.ts\nsrc/z.ts',
      'src/generated/changed-contract.ts',
    ),
    trace(
      'trap-provenance-only',
      'duplicate-looking output\nprovenance: sha256:feedfacecafebeef\nduplicate-looking output end',
      'sha256:feedfacecafebeef',
    ),
    trace(
      'trap-insufficient-view',
      'head summary\nconstraint: DO_NOT_EDIT_PRODUCTION\ntail summary',
      'DO_NOT_EDIT_PRODUCTION',
    ),
    trace(
      'trap-recovery-mismatch',
      'start\ncritical: exact recovery must verify\nend',
      'exact recovery must verify',
    ),
  ];
}
