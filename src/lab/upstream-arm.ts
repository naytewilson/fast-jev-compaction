import { carveHardRoots } from './hard-roots.js';
import { fullPresentation, type ReplayRun, type ReplayTrace } from './replay.js';
import type { InMemoryCAS } from './recovery.js';

export interface UpstreamRetentionScore {
  keepCall: number;
  keepResult: number;
}

export type UpstreamRetentionObserver = (state: unknown) => Promise<UpstreamRetentionScore>;

export const UPSTREAM_PR18_PROVENANCE =
  'tamaratran/fast-jev-compaction#18@4bfc8c7db8a3e88a2f57639ad745a7865da5021e';

export async function runUpstreamComparator(
  trace: ReplayTrace,
  cas: InMemoryCAS,
  observer: UpstreamRetentionObserver,
  threshold: number,
): Promise<ReplayRun> {
  const presentations = [];
  for (const candidate of trace.candidates) {
    if (!cas.verify(candidate.recovery).ok) {
      presentations.push(fullPresentation(candidate));
      continue;
    }

    const carved = carveHardRoots({
      exitStatus: candidate.exit_status,
      stdout: candidate.stdout,
      stderr: candidate.stderr,
      headLines: candidate.head_lines,
      tailLines: candidate.tail_lines,
      presentationBudgetBytes: candidate.presentation_budget_bytes,
    });
    if (carved.kind === 'PRISTINE') {
      presentations.push(fullPresentation(candidate));
      continue;
    }

    const observerState = {
      context: trace.shared_state,
      candidate_id: candidate.candidate_id,
      result_note: `ok, ${Buffer.byteLength(candidate.stdout, 'utf8')} chars (omitted)`,
      hard_roots: carved.hardRoots,
    };

    try {
      const score = await observer(observerState);
      if (score.keepResult >= threshold) {
        presentations.push(fullPresentation(candidate));
        continue;
      }
      const hardText = [
        ...carved.hardRoots.first_lines,
        ...carved.hardRoots.stderr,
        ...carved.hardRoots.last_lines,
      ].join('\n');
      if (score.keepCall >= threshold) {
        presentations.push({
          candidate_id: candidate.candidate_id,
          disposition: 'REFERENTIAL' as const,
          visible_text: hardText,
          source_digest: candidate.recovery.source_digest,
          omitted_bytes: carved.omitted_stdout_bytes,
          recovery_required: carved.omitted_stdout_bytes > 0,
        });
      } else {
        presentations.push({
          candidate_id: candidate.candidate_id,
          disposition: 'EVICTED' as const,
          visible_text: hardText,
          source_digest: candidate.recovery.source_digest,
          omitted_bytes: carved.omitted_stdout_bytes,
          recovery_required: carved.omitted_stdout_bytes > 0,
        });
      }
    } catch {
      presentations.push(fullPresentation(candidate));
    }
  }
  return { arm: 'C', presentations };
}
