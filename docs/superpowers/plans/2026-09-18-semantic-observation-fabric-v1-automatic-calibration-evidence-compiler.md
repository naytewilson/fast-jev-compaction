# Semantic Observation Fabric V1 Automatic Calibration Evidence Compiler Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive calibration artifacts and promotion evidence mechanically from source-bound strong labels, provider replay predictions, and provider-bound measured safety trials so callers no longer inject trusted promotion metrics manually.

**Architecture:** A CalibrationEvidenceCompiler joins STRONG labels to provider-specific predictions, derives deterministic training/holdout Merkle roots, fits all five isotonic calibrators, constructs the ProviderCalibrationArtifact, calibrates holdout predictions, and computes ECE/Brier/NLL/selective-risk/coverage. A ProviderSafetyTrialArtifact seals degraded-evidence trial results for one provider/calibration/policy/ABI tuple. These two issued artifacts compile into a sealed ArtifactPromotionEvidence object consumed by CalibrationArtifactPromotionRegistry.

**Tech Stack:** TypeScript 5.7, Node.js, Vitest 2.1, existing semantic-label/calibration-replay/isotonic/calibration-metrics/degraded-trial/provider-profile/calibration-artifact/promotion modules.

**Spec:** `docs/superpowers/specs/2026-09-18-authority-preserving-semantic-fabric-v1-design.md`

## Global Constraints

- Work only on `north/semantic-fabric-v1-integrated-hardened-calibration-20260918`.
- Starting exact anchor: `e77d45752db0ac6b23b1478fa4a8ebb48df8ec3b`.
- Moving sibling branches remain nonblocking.
- Training and holdout labels must be STRONG and joined exactly to provider-specific predictions.
- Training and holdout replay may not mix provider profile digests.
- Every one of the five registered semantic predicates must exist in both training and holdout evidence.
- Calibration corpus roots are computed, not caller supplied.
- Dataset generation digest is computed from provider profile, roots, sampling policy, label authority policy, and label binding.
- Holdout metrics are computed from calibrated predictions.
- Selective-risk selection uses symmetric confidence: select when `p >= confidenceFloor` or `p <= 1-confidenceFloor`; `confidenceFloor` must be finite in `[0.5,1]`.
- Safety evidence must be provider/calibration/policy/ABI bound.
- Only all-measured safety-trial timing evidence is eligible for policy-authoritative promotion evidence. Synthetic or mixed safety evidence remains research evidence.
- Promotion registry no longer accepts a raw `ArtifactPromotionEvidence` object.
- Production authority remains unauthorized.
- RED -> GREEN exact-SHA CI required.

---

### Task 1: Deterministic provider calibration build artifact

**Files:**
- Create: `src/lab/calibration-evidence-compiler.ts`
- Create: `tests/calibration-evidence-compiler.test.ts`
- Modify: `src/lab/index.ts`

**Interfaces:**

```ts
export interface CalibrationEvidenceCompilerInput {
  providerProfile: ProviderExecutionProfile;
  decisionContractDigest: Digest256;
  compiledProgramDigest: Digest256;
  samplingPolicyDigest: Digest256;
  labelAuthorityPolicyDigest: Digest256;
  labelBindingDigest: Digest256;
  trainingLabels: readonly SemanticCalibrationLabel[];
  trainingPredictions: readonly SemanticReplayPrediction[];
  holdoutLabels: readonly SemanticCalibrationLabel[];
  holdoutPredictions: readonly SemanticReplayPrediction[];
  confidenceFloor: number;
  eceBins: number;
}

export interface CompiledHoldoutMetrics {
  ece: number;
  brier: number;
  nll: number;
  selectiveRisk: number;
  coverage: number;
  sampleCount: number;
}

export class ProviderCalibrationBuildArtifact {
  readonly schema: 'anvil.provider-calibration-build.v1';
  readonly providerProfileDigest: Digest256;
  readonly trainingMerkleRoot: Digest256;
  readonly holdoutMerkleRoot: Digest256;
  readonly datasetGenerationDigest: Digest256;
  readonly calibrationArtifact: ProviderCalibrationArtifact;
  readonly holdoutMetrics: CompiledHoldoutMetrics;
  readonly buildDigest: Digest256;
}

export class CalibrationEvidenceCompiler {
  compile(input: CalibrationEvidenceCompilerInput):
    Readonly<ProviderCalibrationBuildArtifact>;
}

export function verifyProviderCalibrationBuildArtifact(
  value: unknown,
): value is ProviderCalibrationBuildArtifact;
```

**Mechanics:**
- verify provider profile.
- use `joinCalibrationReplay` for training and holdout.
- require all joined samples have `executionProfileDigest === providerProfile.providerProfileDigest`.
- require all five predicates in both splits.
- compute a deterministic Merkle root from canonical leaf digests sorted by `labelId`. Pair adjacent digests; duplicate the final digest at odd tree levels.
- compute `datasetGenerationDigest` from provider profile digest, training root, holdout root, sampling policy digest, label authority policy digest, and label binding digest.
- fit one isotonic model per predicate from training samples.
- create `ProviderCalibrationArtifact` with computed roots/generation and fitted bundle.
- apply each predicate's fitted model to matching holdout samples.
- calculate ECE, Brier, NLL, and symmetric-confidence selective risk/coverage.
- if selected count is zero, compilation fails rather than inserting a fake selective-risk value.
- output is module-issued/frozen; structural copies fail verification.

**RED tests:**
1. complete five-predicate strong corpus compiles and verifies;
2. training or holdout missing one predicate rejects;
3. WEAK label rejects through authoritative replay join;
4. mixed provider profile prediction rejects;
5. changing one prediction changes corpus/build identity;
6. all holdout metrics are finite and computed;
7. confidence floor yielding zero selected samples rejects;
8. structural copy fails verifier.

---

### Task 2: Provider-bound measured safety trial artifact

**Files:**
- Create: `src/lab/provider-safety-trial.ts`
- Create: `tests/provider-safety-trial.test.ts`
- Modify: `src/lab/index.ts`

**Interfaces:**

```ts
export type SafetyEvidenceAuthority =
  | 'MEASURED_SHADOW'
  | 'NON_AUTHORITATIVE';

export interface ProviderSafetyTrialInput {
  providerProfile: ProviderExecutionProfile;
  calibrationIdentity: Digest256;
  policyProfileDigest: Digest256;
  observationABIDigest: Digest256;
  cycles: readonly DegradedTrialCycle[];
}

export class ProviderSafetyTrialArtifact {
  readonly schema: 'anvil.provider-safety-trial.v1';
  readonly providerProfileDigest: Digest256;
  readonly calibrationIdentity: Digest256;
  readonly policyProfileDigest: Digest256;
  readonly observationABIDigest: Digest256;
  readonly result: DegradedTrialResult;
  readonly evidenceAuthority: SafetyEvidenceAuthority;
  readonly cyclesDigest: Digest256;
  readonly trialDigest: Digest256;
}

export class ProviderSafetyTrialRegistry {
  register(input: ProviderSafetyTrialInput):
    Readonly<ProviderSafetyTrialArtifact>;
}

export function verifyProviderSafetyTrialArtifact(
  value: unknown,
): value is ProviderSafetyTrialArtifact;
```

**Mechanics:**
- verify provider profile.
- require provider ABI == trial ABI.
- canonical digest validation.
- evaluate cycles with `evaluateDegradedTrial`.
- `MEASURED_SHADOW` only when `timingEvidence === 'measured'` and false-authority opportunities > 0.
- synthetic/mixed or unscored trial => `NON_AUTHORITATIVE`.
- cycles digest binds exact ordered cycles.
- trial digest binds provider profile, calibration, policy, ABI, cycles digest, result.
- structural copies fail verification.

**RED tests:**
1. measured no-leak degraded trial becomes MEASURED_SHADOW;
2. synthetic trial is NON_AUTHORITATIVE;
3. provider ABI mismatch rejects;
4. a leak is preserved as ARCHITECTURAL_FAILURE;
5. structural copy fails verifier.

---

### Task 3: Sealed promotion evidence compiler

**Files:**
- Create: `src/lab/promotion-evidence.ts`
- Create: `tests/promotion-evidence.test.ts`
- Modify: `src/lab/calibration-artifact-promotion.ts`
- Modify: `tests/calibration-artifact-promotion.test.ts`
- Modify: `tests/provider-authority-fixtures.ts`
- Modify: `src/lab/index.ts`

**Interfaces:**

```ts
export class CompiledArtifactPromotionEvidence {
  readonly schema: 'anvil.compiled-artifact-promotion-evidence.v1';
  readonly artifactDigest: Digest256;
  readonly providerProfileDigest: Digest256;
  readonly calibrationIdentity: Digest256;
  readonly safetyTrialDigest: Digest256;
  readonly strongHoldoutSamples: number;
  readonly falseAuthorityLeaks: number;
  readonly ece: number;
  readonly brier: number;
  readonly selectiveRisk: number;
  readonly coverage: number;
  readonly evidenceDigest: Digest256;
}

export class ArtifactPromotionEvidenceCompiler {
  compile(
    build: ProviderCalibrationBuildArtifact,
    safety: ProviderSafetyTrialArtifact,
  ): Readonly<CompiledArtifactPromotionEvidence>;
}

export function verifyCompiledArtifactPromotionEvidence(
  value: unknown,
): value is CompiledArtifactPromotionEvidence;
```

**Compiler rules:**
- build and safety artifacts must independently verify.
- safety must be `MEASURED_SHADOW`.
- providerProfileDigest, calibrationIdentity, and Observation ABI lineage must match.
- safety false-authority opportunities must be >0.
- evidence fields are taken only from issued build/safety artifacts.
- evidence digest binds build digest + calibration artifact digest + safety trial digest + all metrics.
- structural copies fail verifier.

**CalibrationArtifactPromotionRegistry change:**

Replace:
```ts
promote(artifact, rawEvidence, policy)
```

with:
```ts
promote(
  artifact: ProviderCalibrationArtifact,
  evidence: CompiledArtifactPromotionEvidence,
  policy: CalibrationPromotionPolicy,
)
```

The registry:
- verifies artifact and compiled evidence;
- requires evidence.artifactDigest == artifact.artifactDigest;
- requires evidence.calibrationIdentity == artifact.calibrationIdentity;
- internally maps sealed evidence fields into `evaluateCalibrationPromotion`;
- never accepts raw metric vectors.

**RED tests:**
1. matching measured build+safety compiles promotion evidence;
2. synthetic safety evidence cannot compile;
3. JEV build + Qwen safety rejects;
4. structural evidence copy fails;
5. promotion registry rejects plain metric objects;
6. promotion remains blocked on one false-authority leak.

---

### Task 4: Authority-chain regression and closure

**Files:**
- Modify: `tests/promotion-credential.test.ts`
- Modify: `tests/authority-registry.test.ts`
- Modify: `tests/authority-router.test.ts`

Fixture chain becomes:

```text
STRONG training labels + provider predictions
STRONG holdout labels + provider predictions
        -> CalibrationEvidenceCompiler
        -> ProviderCalibrationBuildArtifact
        -> ProviderCalibrationArtifact

measured degraded safety cycles
        -> ProviderSafetyTrialArtifact

build + safety
        -> CompiledArtifactPromotionEvidence
        -> PromotedCalibrationArtifact
        -> PromotedAuthorityCredential
        -> AuthorityRegistry
        -> AuthorityRouter
```

Regression:
- no raw promotion metrics on authority path;
- no synthetic safety evidence on authority path;
- no cross-provider artifact/safety/credential transfer;
- evidence deficit continues to outrank provider credential.

**Verification:**
```text
npm test -- --run tests/calibration-evidence-compiler.test.ts tests/provider-safety-trial.test.ts tests/promotion-evidence.test.ts tests/calibration-artifact-promotion.test.ts tests/promotion-credential.test.ts tests/authority-registry.test.ts tests/authority-router.test.ts
npm test
npm run typecheck
npm run build
git diff --check
```

Preserve RED/GREEN exact SHAs/workflows/test totals in PR #4 and Drive.

**Next cloud wave:** provider-specific shadow/canary orchestration that feeds the same corpus through JEV/Mavis/Qwen adapters and automatically materializes training/holdout predictions, while real Neo/ANE measurement continues independently.
