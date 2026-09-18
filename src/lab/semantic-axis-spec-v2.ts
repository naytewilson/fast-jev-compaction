import {
  MODELED_SEMANTIC_AXES_V2,
  type ModeledSemanticAxisV2,
} from './semantic-contract-v2.js';
import { sha256Digest } from './recovery.js';

// Shared V2 axis/question specification — the single source for how the
// four modeled V2 predicates are phrased to providers. Consumed by:
//   * system-one-adapter-v2 (System One question bodies)
//   * tools/noul-manifest-v2   (local probe prompt generation)
// A second drifting copy of these semantics is a version-boundary bug.
// The spec digest binds every artifact that consumed this phrasing.

export const SEMANTIC_AXIS_INSTRUCTIONS_V2: Readonly<
  Record<ModeledSemanticAxisV2, string>
> = Object.freeze({
  evidence_sufficient:
    'Estimate whether the bounded candidate view and shared state are sufficient to judge this exact candidate for the active mission. Stale, missing, truncated, task-mismatched, or orthogonal evidence should reduce this score.',
  still_needed:
    'Estimate whether this exact source-bound candidate carries information likely needed for the active mission.',
  full_content_needed:
    'Estimate whether replacing omitted source content with an exact reversible reference would materially reduce usefulness for the active mission.',
  unresolved_evidence:
    'Estimate whether the candidate contains evidence that merits review because of an unresolved failure, warning, dependency, verification gap, or contradiction. Missing evidence alone is not sufficient to establish this predicate.',
});

// Yes/No probe phrasing for the local native scorer. Derived from the V2
// registered semantic definitions — NOT carried over from the V1 lane.
export const SEMANTIC_AXIS_PROBE_QUESTIONS_V2: Readonly<
  Record<ModeledSemanticAxisV2, string>
> = Object.freeze({
  evidence_sufficient:
    'Is the bounded evidence view shown above sufficient to judge the registered retention predicates for this exact candidate and active mission?',
  still_needed:
    'Does this exact source-bound candidate carry information likely needed for the active mission?',
  full_content_needed:
    'Would replacing the omitted source content with an exact reversible reference materially reduce usefulness for the active mission?',
  unresolved_evidence:
    'Does this candidate contain evidence that merits review because of an unresolved failure, warning, dependency, verification gap, or contradiction? (Missing evidence alone does not count.)',
});

export const SEMANTIC_AXIS_SPEC_V2 = Object.freeze({
  schema: 'anvil.semantic-axis-spec.v2' as const,
  observationAbi: 'anvil.semantic-observation-abi.v2' as const,
  axes: MODELED_SEMANTIC_AXES_V2,
  instructions: SEMANTIC_AXIS_INSTRUCTIONS_V2,
  probeQuestions: SEMANTIC_AXIS_PROBE_QUESTIONS_V2,
  criteria: Object.freeze({
    true: 'The predicate applies.',
    false: 'The predicate does not apply.',
  }),
});

export const SEMANTIC_AXIS_SPEC_DIGEST_V2 = sha256Digest(
  JSON.stringify(SEMANTIC_AXIS_SPEC_V2),
);
