# Semantic Observation Fabric V1 Degraded-Evidence Trial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the cloud-side scientific harness that converts verified downstream outcomes into counterfactual regret evidence and measures whether epistemic masking + self-healing authority suppress false authority under degraded evidence and profile drift.

**Architecture:** Add a source-bound Counterfactual Regret Ledger, calibration/risk metrics, and a deterministic degraded-evidence trial evaluator. The harness does not pretend synthetic timings are hardware measurements. Instead, it consumes measured/synthetic cycle records, computes risk/coverage/calibration statistics, and enforces the architecture's false-authority invariants. These artifacts become the shared experiment ABI that later JEV, Mavis, and Qwen/ANE execution profiles can feed.

**Tech Stack:** TypeScript 5.7, Node.js, Vitest 2.1, existing V1 identity, mask, receipt, calibration, recalibration, router, and replay metric primitives.

**Spec:** `docs/superpowers/specs/2026-09-18-authority-preserving-semantic-fabric-v1-design.md`

## Global Constraints

- Isolated lab only. No production port or live provider credential.
- Synthetic timing values must be labeled synthetic; no ANE/provider SLA claim may be inferred.
- False Authority means policy-triggered execution on a lane that lacks required policy authority.
- Evidence sufficiency and calibration authority are distinct.
- Counterfactual outcomes become calibration-authoritative only when source-bound and mechanically/human verified under STRONG label rules.
- A model/contract/profile drift event must never silently inherit old calibration.
- Trial metrics report both observed zero-leak results and a finite statistical upper bound, never "true risk = zero".
- Use RED -> GREEN exact-head Actions.

---

## File Structure

### New files

- `src/lab/regret-ledger.ts`  
  Decision/outcome join, source-bound counterfactual regret classification, STRONG/WEAK label materialization.

- `src/lab/calibration-metrics.ts`  
  ECE, Brier, NLL, threshold-local error, selective risk/coverage, FAR/FASR, rule-of-three upper bound.

- `src/lab/degraded-trial.ts`  
  Fault-scenario vocabulary and aggregate self-healing trial evaluator.

- `tests/regret-ledger.test.ts`
- `tests/calibration-metrics.test.ts`
- `tests/degraded-trial.test.ts`

### Modified

- `src/lab/index.ts`

---

### Task 1: Counterfactual Regret Ledger

**Required types**

```ts
type RegretDisposition =
  | 'KEEP_FULL'
  | 'KEEP_HEAD_TAIL'
  | 'KEEP_REFERENCE'
  | 'EVICT_FROM_PRESENTATION'
  | 'ABSTAIN';

interface RegretDecisionRecord {
  decisionId: string;
  requestId: string;
  sourceDigest: string;
  observationDigest: string;
  calibrationIdentity: string;
  authorityIdentity: string;
  disposition: RegretDisposition;
}

interface RegretOutcomeRecord {
  decisionId: string;
  outcomeDigest: string;
  verified: boolean;
  verifierIdentity?: string;
  taskSucceeded: boolean;
  unnecessaryReread: boolean;
  exactRehydrationRequired: boolean;
}
```

**Behavior**

- ledger rejects duplicate decision IDs;
- outcome requires an existing decision and is write-once;
- `classify(decisionId)` returns:
  - `SAFE_EVICTION` when reduced/evicted presentation caused neither failure nor reread/rehydration;
  - `FALSE_EVICTION` when reduced/evicted presentation caused task failure, unnecessary reread, or exact rehydration;
  - `SAFE_RETENTION` for full retention with successful outcome;
  - `UNRESOLVED` for unverified outcomes;
- `materializeCalibrationLabels()` emits STRONG labels only when `verified=true` and `verifierIdentity` exists;
- unverified outcomes may be represented as WEAK research labels but must never enter authoritative label selection;
- label outcome digest must bind decision + verified outcome, not only the final boolean.

**RED tests**

- false eviction from later rehydration;
- safe eviction from successful no-reread outcome;
- unverified outcome does not yield STRONG calibration label;
- duplicate decision/outcome fails closed;
- source digest survives label materialization.

---

### Task 2: Calibration and false-authority metrics

**Required functions**

```ts
expectedCalibrationError(samples, bins)
brierScore(samples)
negativeLogLikelihood(samples)
thresholdLocalCalibrationError(samples, threshold, radius)
selectiveRiskCoverage(samples)
falseAuthorityMetrics(records, confidence)
```

Sample:

```ts
interface BinaryCalibrationSample {
  probability: number;
  outcome: 0 | 1;
  selected?: boolean;
}
```

False-authority record:

```ts
interface AuthorityTrialRecord {
  shouldHavePolicyAuthority: boolean;
  policyTriggered: boolean;
}
```

**Behavior**

- probabilities must be finite in [0,1];
- ECE uses nonempty equal-width probability bins;
- Brier = mean squared error;
- NLL clamps only for numerical log safety, not to change source probability identity;
- threshold-local metric includes samples within radius of policy threshold;
- selective risk/coverage reports selected count, coverage, errors, risk;
- false-authority:
  - opportunities = records with `shouldHavePolicyAuthority=false`;
  - leaks = those opportunities with `policyTriggered=true`;
  - FASR = 1 - leaks/opportunities;
  - if leaks=0, report approximate 95% FAR upper bound `min(1, 3/opportunities)`;
  - no opportunities => metrics explicitly unscored/null instead of claiming 100%.

**RED tests**

Use exact small vectors with hand-computable results plus:
- zero leaks/10,000 gives observed FASR 1 and approximate upper FAR 0.0003;
- one leak is never represented as zero risk;
- no opportunities returns null FASR/bound.

---

### Task 3: Degraded Evidence / Self-Healing Trial evaluator

**Scenario vocabulary**

```text
FULL
PARTIAL
HEAD_TAIL
CONTRADICTORY
IRRELEVANT
ABSENT
MODEL_BUMP
QUANTIZATION_SHIFT
NORMALIZER_SHIFT
CALIBRATION_POISON_ATTEMPT
DUPLICATE_RECALIBRATION_STORM
CANARY_REGRESSION
ROLLBACK
STALE_EVIDENCE_VIEW
RECEIPT_ENRICHMENT_PRESSURE
PROVIDER_IDENTITY_DOWNGRADE
```

**Cycle record**

```ts
interface DegradedTrialCycle {
  scenario: DegradedScenario;
  shouldHavePolicyAuthority: boolean;
  policyTriggered: boolean;
  taskCompleted: boolean;
  fallbackActivated: boolean;
  detectMs: number;
  routeMs: number;
  firstUsefulResultMs: number | null;
  fallbackCompleteMs: number | null;
  calibrationProbability?: number;
  calibrationOutcome?: 0 | 1;
  syntheticTiming: boolean;
}
```

**Aggregate output**

- cycle count and scenario counts;
- false authority metrics;
- fallback coverage retention among cycles requiring fallback;
- p50/p95/p99 for `T_detect + T_route`;
- p50/p95/p99 first-useful-result where present;
- calibration metrics when labels exist;
- `timingEvidence = 'synthetic' | 'measured' | 'mixed'`;
- architecture verdict:
  - `ARCHITECTURAL_FAILURE` if any false-authority leak;
  - `PASS_SYNTHETIC` if no leaks and all timing records synthetic;
  - `PASS_MEASURED` only when no leaks and all timings measured;
  - `UNSCORED` when no false-authority opportunities exist.

**Important:** PASS_SYNTHETIC is not production/hardware clearance.

**RED tests**

- full + partial + model-bump mixed matrix with no leaks yields PASS_SYNTHETIC;
- one invalid-lane policy trigger yields ARCHITECTURAL_FAILURE;
- measured-only zero-leak matrix yields PASS_MEASURED;
- p99 route metric is computed, not hard-coded;
- scenario counts stable;
- no invalid-lane opportunities yields UNSCORED.

---

### Task 4: Cloud closure and local-hardware handoff gate

After GREEN Actions:

- update PR #2 controller evidence;
- update Drive current pointer and Active Pointer;
- create a dedicated local-hardware request only when the cloud trial ABI is frozen.

The local request must pull the exact green SHA and measure, not assume:

- local Qwen/ANE model identity and assurance;
- Core ML package/weights/tokenizer/quantization/runtime identities;
- real `T_detect + T_route`;
- local observer latency;
- shape-bucket throughput;
- memory/copy behavior visible at ANVIL-owned boundaries;
- degraded evidence trial feed through the same ABI.

No local worker may activate production SIEVE presentation or treat local Qwen as an authority fallback until a CalibrationIdentity/AuthorityIdentity exists for it.
