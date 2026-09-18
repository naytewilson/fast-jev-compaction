import type { Digest256 } from './identity.js';
import { sha256Digest } from './recovery.js';
import type { ReplayTrace } from './replay.js';
import type { SemanticCalibrationLabelV2 } from './semantic-label-v2.js';
import type { ModeledSemanticAxisV2 } from './semantic-contract-v2.js';
import { MODELED_SEMANTIC_AXES_V2 } from './semantic-contract-v2.js';

// V2 mechanical labels: same deterministic campaign ground truth, derived
// explicitly under the anvil.context-retention.v2 contract. NOT produced by
// deleting recoverable from V1 labels — the target function is restated
// under the V2 predicate definitions, and V2 removes modeled recoverability
// entirely (mechanical recovery remains separately authoritative).
//
// V2 semantic delta honored here:
//   unresolved_evidence is true only when the candidate CONTAINS evidence
//   that merits review (unresolved failure, warning, dependency,
//   verification gap, or contradiction). Missing or truncated evidence
//   alone does not establish the predicate.

export const CAMPAIGN_CORPUS_ID_V2 = 'anvil.campaign-corpus.v2';
export const MECHANICAL_VERIFIER_ID_V2 = 'anvil.mechanical-source-verifier.v2';

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

const UNRESOLVED_EVIDENCE_PATTERN =
  /FAIL|error|warning|deprecated|use-after-free|verification.*(mismatch|fail|gap)|contradict/i;

export function mechanicalLabelTargetsV2(
  candidate: ReplayTrace['candidates'][number],
): Record<ModeledSemanticAxisV2, 0 | 1> {
  // stderr and exit_status are always surfaced through hard_roots, so they
  // never reduce view sufficiency; only omitted decisive evidence does.
  const viewSufficient =
    candidate.critical_evidence.length === 0 ? 1 : criticalInView(candidate) ? 1 : 0;
  // V2 unresolved_evidence: the candidate must CONTAIN review-meriting
  // evidence — a nonzero exit, stderr output, or source content matching
  // failure/warning/verification-gap/contradiction markers. Omitted or
  // absent evidence is not, by itself, unresolved evidence.
  const hasUnresolvedEvidence =
    candidate.exit_status !== 0 ||
    candidate.stderr.length > 0 ||
    UNRESOLVED_EVIDENCE_PATTERN.test(candidate.stdout);
  return {
    evidence_sufficient: viewSufficient as 0 | 1,
    still_needed: criticalInSource(candidate) ? 1 : 0,
    full_content_needed: omittedContainsCritical(candidate) ? 1 : 0,
    unresolved_evidence: hasUnresolvedEvidence ? 1 : 0,
  };
}

export function mintCampaignLabelsV2(input: {
  traces: readonly ReplayTrace[];
  decisionContractDigest: Digest256;
  labelBindingDigest: Digest256;
}): readonly SemanticCalibrationLabelV2[] {
  const labels: SemanticCalibrationLabelV2[] = [];
  for (const trace of input.traces) {
    for (const candidate of trace.candidates) {
      const targets = mechanicalLabelTargetsV2(candidate);
      const outcomeDigest = sha256Digest(JSON.stringify({
        schema: 'anvil.campaign-outcome.v2',
        traceId: trace.trace_id,
        candidateId: candidate.candidate_id,
        sourceDigest: candidate.recovery.source_digest,
        targets,
      }));
      for (const predicateId of MODELED_SEMANTIC_AXES_V2) {
        labels.push({
          labelId: `${trace.trace_id}:${candidate.candidate_id}:${predicateId}`,
          authority: 'STRONG',
          decisionContractDigest: input.decisionContractDigest,
          predicateId,
          labelBindingDigest: input.labelBindingDigest,
          sourceDigest: candidate.recovery.source_digest,
          outcomeDigest,
          target: targets[predicateId],
          verifierIdentity: MECHANICAL_VERIFIER_ID_V2,
        });
      }
    }
  }
  return labels;
}
