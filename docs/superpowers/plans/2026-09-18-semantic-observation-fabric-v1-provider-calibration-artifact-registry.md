# Semantic Observation Fabric V1 Provider Calibration Artifact Registry Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make provider authority credentials descend from a sealed, provider-bound calibration artifact rather than a generic caller-constructed promotion result.

**Architecture:** Build an immutable ProviderCalibrationArtifact from one verified ProviderExecutionProfile, one frozen DecisionContract/compiled program identity, one exact calibration dataset generation, one label binding, and a complete five-predicate calibrator bundle. A PromotionArtifactRegistry evaluates promotion evidence against that exact artifact and emits a sealed PromotedCalibrationArtifact. PromotionAuthorityIssuer then accepts only that sealed promoted artifact, eliminating the generic promotion-result ingress.

**Tech Stack:** TypeScript 5.7, Node.js, Vitest 2.1, existing ProviderExecutionProfile, CalibrationIdentity, CalibrationDatasetIdentity, semantic label/replay/isotonic calibration, promotion gate, authority credential modules.

**Spec:** `docs/superpowers/specs/2026-09-18-authority-preserving-semantic-fabric-v1-design.md`

## Global Constraints

- Work only on `north/semantic-fabric-v1-integrated-hardened-calibration-20260918`.
- Starting exact anchor: `cd395e9c0e287f3ec23e772298e5fd533ff6dc85`.
- Moving sibling branches are nonblocking.
- One calibration artifact belongs to exactly one ProviderExecutionProfile digest.
- All five registered semantic predicates must have exactly one fitted calibrator.
- Every calibrator in an artifact must bind the same full providerProfileDigest through its executionProfileDigest.
- Training/holdout roots, sampling policy, label authority policy, dataset generation, label binding, calibrator specs, and fitted parameters must all contribute to CalibrationIdentity.
- Artifact registration never grants policy authority.
- Promotion eligibility is evaluated inside the promotion-artifact registry against the artifact CalibrationIdentity.
- Only a sealed PromotedCalibrationArtifact may be passed to PromotionAuthorityIssuer.
- LocalHardwareReceipt V2 and measurement acceptance remain incapable of producing a PromotedCalibrationArtifact.
- Provider calibration artifacts never transfer across JEV/Mavis/Qwen profiles.
- Production port remains unauthorized.
- RED -> GREEN exact-SHA CI required.

---

### Task 1: ProviderCalibrationArtifact

**Files:**
- Create `src/lab/calibration-artifact.ts`
- Create `tests/calibration-artifact.test.ts`
- Modify `src/lab/index.ts`

**Interfaces:**

```ts
export interface CalibrationDatasetComponents {
  trainingMerkleRoot: Digest256;
  holdoutMerkleRoot: Digest256;
  samplingPolicyDigest: Digest256;
  labelAuthorityPolicyDigest: Digest256;
  datasetGenerationDigest: Digest256;
}

export interface ProviderCalibrationArtifactInput {
  providerProfile: ProviderExecutionProfile;
  decisionContractDigest: Digest256;
  compiledProgramDigest: Digest256;
  dataset: CalibrationDatasetComponents;
  labelBindingDigest: Digest256;
  calibrators: readonly IsotonicCalibrationModel[];
}

export class ProviderCalibrationArtifact {
  readonly schema: 'anvil.provider-calibration-artifact.v1';
  readonly providerId: string;
  readonly providerProfileDigest: Digest256;
  readonly calibrationDatasetIdentity: Digest256;
  readonly calibrationIdentity: Digest256;
  readonly calibratorBundleSpecDigest: Digest256;
  readonly fittedParameterBundleDigest: Digest256;
  readonly artifactDigest: Digest256;
  readonly calibrators: readonly IsotonicCalibrationModel[];
}

export class ProviderCalibrationArtifactRegistry {
  register(input: ProviderCalibrationArtifactInput):
    Readonly<ProviderCalibrationArtifact>;
}

export function verifyProviderCalibrationArtifact(
  value: unknown,
): value is ProviderCalibrationArtifact;
```

**Required mechanics:**
- Provider profile must verify.
- Calibrators must contain exactly the five `MAPPED_OBSERVATION_AXES`, no duplicate/missing predicate.
- Each calibrator must have `executionProfileDigest === providerProfile.providerProfileDigest`.
- Each calibrator model must be internally re-digestible: recompute its fittedParametersDigest from its exact core and reject mismatch.
- Bundle order is canonical `MAPPED_OBSERVATION_AXES`.
- `calibratorBundleSpecDigest` binds ordered predicate + calibratorSpecDigest.
- `fittedParameterBundleDigest` binds ordered predicate + fittedParametersDigest.
- `calibrationDatasetIdentity = deriveCalibrationDatasetIdentity(dataset)`.
- `calibrationIdentity = deriveCalibrationIdentity(...)` using:
  provider profile executionSemanticsDigest,
  provider profile modelIdentityDigest,
  provider profile normalizerDigest,
  exact dataset component digests,
  labelBindingDigest,
  bundle spec digest,
  fitted parameter bundle digest.
- `artifactDigest` additionally binds providerProfileDigest, observationABIDigest, calibrationIdentity, dataset identity, and bundle identities.
- Artifact object must be module-issued, frozen, and verifier must reject structural copies.

**RED tests:**
1. valid five-predicate provider artifact verifies;
2. missing predicate rejects;
3. duplicate predicate rejects;
4. calibrator from different provider profile rejects;
5. tampered fittedParametersDigest rejects;
6. changing dataset generation or model/provider profile changes CalibrationIdentity/artifactDigest;
7. structural copy fails verifier.

---

### Task 2: PromotedCalibrationArtifact registry

**Files:**
- Create `src/lab/calibration-artifact-promotion.ts`
- Create `tests/calibration-artifact-promotion.test.ts`
- Modify `src/lab/promotion-credential.ts`
- Modify `tests/promotion-credential.test.ts`
- Modify `src/lab/index.ts`

**Interfaces:**

```ts
export interface ArtifactPromotionEvidence
  extends Omit<CalibrationPromotionEvidence, 'calibrationIdentity'> {}

export class PromotedCalibrationArtifact {
  readonly schema: 'anvil.promoted-calibration-artifact.v1';
  readonly artifactDigest: Digest256;
  readonly providerProfileDigest: Digest256;
  readonly calibrationIdentity: Digest256;
  readonly promotionPolicyDigest: Digest256;
  readonly promotionEvidenceDigest: Digest256;
  readonly promotedArtifactDigest: Digest256;
}

export class CalibrationArtifactPromotionRegistry {
  promote(
    artifact: ProviderCalibrationArtifact,
    evidence: ArtifactPromotionEvidence,
    policy: CalibrationPromotionPolicy,
  ): Readonly<PromotedCalibrationArtifact>;
}

export function verifyPromotedCalibrationArtifact(
  value: unknown,
): value is PromotedCalibrationArtifact;
```

**Mechanics:**
- artifact verifier must pass.
- registry internally calls `evaluateCalibrationPromotion({...evidence, calibrationIdentity: artifact.calibrationIdentity}, policy)`.
- non-`CANARY_ELIGIBLE` result throws and emits no promoted object.
- promotion evidence digest binds all evidence values and champion metrics.
- promoted artifact digest binds artifactDigest, providerProfileDigest, calibrationIdentity, promotion policy digest, promotion evidence digest.
- structural copies fail verification.

**PromotionAuthorityIssuer change:**
Replace generic `providerProfile + promotion` ingress with:

```ts
issue({
  providerProfile,
  promotedArtifact,
  policyProfileDigest,
  observationABIDigest,
  sourceLineageDigest,
  authorityGeneration,
})
```

Issuer requires:
- provider profile verifies;
- promoted artifact verifies;
- promotedArtifact.providerProfileDigest === providerProfile.providerProfileDigest;
- ABI matches provider profile;
- credential calibration identity comes only from promotedArtifact.calibrationIdentity;
- promotion policy digest comes only from promotedArtifact.promotionPolicyDigest.

**RED tests:**
1. ineligible artifact stays unpromoted;
2. eligible artifact promotes;
3. structural promoted-artifact copy fails;
4. JEV promoted artifact cannot mint Qwen credential;
5. fake generic CalibrationPromotionResult cannot satisfy issuer API/runtime;
6. LocalHardwareReceipt-like object cannot satisfy promoted artifact verifier.

---

### Task 3: Registry and router regression

**Files:**
- Modify `tests/authority-registry.test.ts`
- Modify `tests/authority-router.test.ts`

Update helpers to create a real:
ProviderExecutionProfile -> five calibrator bundle -> ProviderCalibrationArtifact -> PromotedCalibrationArtifact -> PromotedAuthorityCredential -> AuthorityRouteGrant.

Required regression properties:
- no direct mask registration;
- no direct generic promotion-result credential;
- source-lineage mismatch fails;
- evidence deficit still outranks a valid primary credential;
- provider-bound alternate route works only with its own promoted artifact.

---

### Task 4: Full verification and continuity

**Verification:**

```text
npm test -- --run tests/calibration-artifact.test.ts tests/calibration-artifact-promotion.test.ts tests/promotion-credential.test.ts tests/authority-registry.test.ts tests/authority-router.test.ts
npm test
npm run typecheck
npm run build
git diff --check
```

Preserve:
- RED exact SHA/workflow and inherited pass count;
- GREEN exact SHA/workflow and four-runner matrix;
- test files/test total;
- Drive Active Pointer + current pointer update.

**Next cloud wave:** provider-specific shadow/canary comparison over real/synthetic replay labels, plus automatic calibration artifact construction directly from replay outputs so callers do not supply promotion metrics manually.
