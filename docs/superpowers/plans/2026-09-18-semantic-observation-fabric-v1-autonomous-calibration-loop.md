# Semantic Observation Fabric V1 Autonomous Calibration Loop Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn source-bound STRONG counterfactual outcomes into typed semantic calibration labels, replay a new execution profile over those exact labels, fit a deterministic isotonic calibrator, and gate the result for canary eligibility without granting authority directly.

**Architecture:** Calibration truth is predicate-specific and model-independent. A verified downstream outcome creates a semantic label tied to the exact contract/predicate semantics, not to an old model's logits. A new execution profile must replay the exact source-bound examples to produce fresh raw probabilities. Strict joining yields calibration samples. A deterministic isotonic PAV fitter creates a versionable fitted-parameter digest. A separate deterministic promotion gate evaluates holdout risk/calibration and may return only `CANARY_ELIGIBLE` or `REMAIN_SHADOW`; it never activates policy authority itself.

**Tech Stack:** TypeScript 5.7, Vitest 2.1, existing V1 identity/regret/calibration/replay metrics.

**Spec:** `docs/superpowers/specs/2026-09-18-authority-preserving-semantic-fabric-v1-design.md`

## Global Constraints

- STRONG semantic labels require source digest, contract digest, predicate identity, outcome digest, verifier identity, and binary target.
- Labels bind semantic meaning, not provider/model identity. SOFT_SEMANTIC model drift may replay them; HARD_SEMANTIC contract/predicate drift may not silently reuse them.
- Old logits never calibrate a new model. New-profile predictions must be replayed and exact-joined to labels.
- Counterfactual regret can label `still_needed` only when omission/reduction actually supplied counterfactual evidence:
  - FALSE_EVICTION => target 1
  - SAFE_EVICTION => target 0
  - SAFE_RETENTION / UNRESOLVED => no counterfactual `still_needed` label
- Isotonic calibration must be deterministic independent of input order.
- WEAK labels never enter authoritative fitting.
- Promotion gate is deterministic but does not promote itself. It only emits canary eligibility.
- Zero false-authority leaks is a default policy input, not a scientific claim that true risk equals zero.
- Use RED -> GREEN exact-head Actions.

## Files

- Create: `src/lab/semantic-label.ts`
- Create: `src/lab/calibration-replay.ts`
- Create: `src/lab/isotonic-calibrator.ts`
- Create: `src/lab/calibration-promotion.ts`
- Create tests for each
- Modify: `src/lab/regret-ledger.ts`
- Modify: `src/lab/index.ts`

## Task 1: Typed semantic calibration labels

Define:

```ts
interface SemanticCalibrationLabel {
  labelId: string;
  authority: 'STRONG' | 'WEAK';
  decisionContractDigest: Digest256;
  predicateId: MappedObservationAxis;
  labelBindingDigest: Digest256;
  sourceDigest: Digest256;
  outcomeDigest: Digest256;
  target: 0 | 1;
  verifierIdentity?: string;
}
```

Implement validation/freeze helpers. STRONG without verifier fails closed. Duplicate label IDs are rejected by authoritative selection.

Extend `CounterfactualRegretLedger` with:

```ts
materializeStillNeededLabels(context): readonly SemanticCalibrationLabel[]
```

Mapping:
- verified FALSE_EVICTION => STRONG target 1
- verified SAFE_EVICTION => STRONG target 0
- unverified reduced outcome may emit WEAK research label if target can be inferred, but must not enter authoritative fit
- KEEP_FULL / SAFE_RETENTION does not produce a still-needed counterfactual label

RED tests prove those mappings and contract/label-binding provenance.

## Task 2: Exact new-profile replay join

Define:

```ts
interface SemanticReplayPrediction {
  labelId: string;
  predicateId: MappedObservationAxis;
  sourceDigest: Digest256;
  executionProfileDigest: Digest256;
  observationDigest: Digest256;
  probability: number;
}

interface CalibrationReplaySample {
  labelId: string;
  sourceDigest: Digest256;
  predicateId: MappedObservationAxis;
  executionProfileDigest: Digest256;
  observationDigest: Digest256;
  probability: number;
  target: 0 | 1;
}
```

Implement:

```ts
joinCalibrationReplay(labels, predictions)
```

Requirements:
- only STRONG labels accepted;
- exact cardinality and label-ID set equality;
- predicate/source identity exact-match;
- one execution profile digest across batch;
- probability finite in [0,1];
- duplicate/missing/unknown IDs fail closed;
- deterministic output sorted by labelId.

RED tests include stale source digest, mixed execution profiles, missing prediction, and order-independence.

## Task 3: Deterministic isotonic calibrator

Implement Pool Adjacent Violators over replay samples.

Output:

```ts
interface IsotonicCalibrationModel {
  schema: 'anvil.isotonic-calibrator.v1';
  sampleCount: number;
  executionProfileDigest: Digest256;
  predicateId: MappedObservationAxis;
  blocks: readonly {
    minRawProbability: number;
    maxRawProbability: number;
    calibratedProbability: number;
    sampleCount: number;
  }[];
  calibratorSpecDigest: Digest256;
  fittedParametersDigest: Digest256;
}
```

Requirements:
- group equal raw probabilities before PAV;
- sorted deterministic fit independent of input order;
- monotonically non-decreasing calibrated outputs;
- `applyIsotonicCalibration(model,p)` piecewise-constant with boundary clamping;
- model binds one execution profile and one predicate;
- no WEAK label route reaches fitter;
- parameter digest binds exact blocks/count/profile/predicate.

RED tests:
- known violating points pool correctly;
- result monotonic;
- shuffled input produces identical digest;
- mixed profile/predicate rejects;
- boundary apply works.

## Task 4: Deterministic canary-eligibility gate

Define config-driven policy:

```ts
interface CalibrationPromotionPolicy {
  minStrongHoldoutSamples: number;
  maxFalseAuthorityLeaks: number;
  maxECE: number;
  maxBrier: number;
  maxSelectiveRisk: number;
  minCoverage: number;
  maxRegressionTolerance?: number;
}
```

Evidence:

```ts
interface CalibrationPromotionEvidence {
  calibrationIdentity: Digest256;
  strongHoldoutSamples: number;
  falseAuthorityLeaks: number;
  ece: number;
  brier: number;
  selectiveRisk: number;
  coverage: number;
  champion?: {
    ece: number;
    brier: number;
    selectiveRisk: number;
    coverage: number;
  };
}
```

Return only:

```text
CANARY_ELIGIBLE
REMAIN_SHADOW
```

with reason codes.

Requirements:
- insufficient holdout, any policy-budget breach, invalid metric, or champion regression beyond tolerance => REMAIN_SHADOW;
- eligibility never changes CalibrationGenerationRegistry itself;
- output binds calibration identity and policy digest so later PromotionController can receipt the decision.

RED tests prove no accidental authority transition.

## Closure

After GREEN Actions:
- publish exact RED/GREEN evidence to PR #2 and Drive;
- keep Neo worker branch untouched;
- next cloud wave may add multi-provider portfolio comparison over the same Observation ABI while the local ANE measurement proceeds independently.
