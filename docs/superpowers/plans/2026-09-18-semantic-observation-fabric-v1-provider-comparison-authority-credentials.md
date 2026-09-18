# Semantic Observation Fabric V1 Provider Comparison + Promotion Credential Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provider-neutral comparison plane for JEV, Mavis, and Qwen/ANE execution profiles and replace caller-supplied authority registration with promotion-issued, provider-bound authority credentials.

**Architecture:** A provider profile describes observation execution identity only. Provider comparison executes the same frozen semantic program and Observation ABI independently per provider, producing source-bound scoreboards and receipts while isolating failures. Calibration remains provider/execution-profile specific. Policy authority is represented by a sealed `PromotedAuthorityCredential` minted only through a promotion issuer after an eligible calibration-promotion decision; `AuthorityRegistry` consumes those credentials and no longer accepts caller-defined masks.

**Tech Stack:** TypeScript 5.7, Node.js built-in crypto, Vitest 2.1, existing Semantic Fabric V1 mapped request/replay/receipt/calibration/promotion/authority modules.

**Spec:** `docs/superpowers/specs/2026-09-18-authority-preserving-semantic-fabric-v1-design.md`

## Global Constraints

- Work only on `north/semantic-fabric-v1-integrated-hardened-calibration-20260918`.
- Starting exact source anchor: `b8e965d4be46403cfb092009f6f4b6aff329271c`.
- Moving sibling branches are parallel evidence streams, not execution blockers.
- Do not mutate production ANVIL, local-agent-gateway, SIEVE, ReCompress, Paseo, protected branches, or credentials.
- All providers execute the same registered semantic predicates and Observation ABI.
- Provider-specific prompt wording may translate the ABI but may not add semantic authority or policy actions.
- A provider profile grants zero policy authority.
- Calibration samples from different execution-profile digests may never be mixed in one fitted calibrator.
- A promotion credential is bound to one provider profile, one CalibrationIdentity, one PolicyProfile digest, one Observation ABI digest, one source-lineage scope, and one authority generation.
- No credential or authority identity may transfer across provider profiles.
- Local hardware receipts and measurement acceptance do not mint authority credentials.
- Provider failure is lane-local and must not poison other provider results.
- JEV, Mavis, and Qwen/ANE may all remain shadow-only simultaneously.
- RED -> GREEN exact-SHA GitHub Actions evidence is required.
- No production port is authorized by this plan.

---

## File Structure

### New files

- `src/lab/provider-profile.ts`
  Provider-neutral execution-profile identity and assurance model.

- `src/lab/promotion-credential.ts`
  Sealed promotion-issued authority credential and issuer.

- `src/lab/provider-comparison.ts`
  Independent multi-provider execution/comparison harness and scoreboard.

- `tests/provider-profile.test.ts`
- `tests/promotion-credential.test.ts`
- `tests/provider-comparison.test.ts`

### Modified files

- `src/lab/authority-registry.ts`
- `src/lab/index.ts`
- `tests/authority-registry.test.ts`
- `tests/authority-router.test.ts`

---

### Task 1: ProviderExecutionProfile identity

**Files:**
- Create: `tests/provider-profile.test.ts`
- Create: `src/lab/provider-profile.ts`
- Modify: `src/lab/index.ts`

**Interfaces:**

```ts
export type SemanticProviderKind =
  | 'jev-system-one'
  | 'mavis'
  | 'qwen-ane'
  | 'custom';

export type ProviderModelAssurance =
  | 'contentVerified'
  | 'providerAttested'
  | 'opaqueVersioned'
  | 'unknown';

export interface ProviderExecutionProfileInput {
  providerId: string;
  providerKind: SemanticProviderKind;
  modelIdentityDigest: Digest256;
  modelAssurance: ProviderModelAssurance;
  executionSemanticsDigest: Digest256;
  normalizerDigest: Digest256;
  observationABIDigest: Digest256;
}

export interface ProviderExecutionProfile
  extends ProviderExecutionProfileInput {
  schema: 'anvil.provider-execution-profile.v1';
  providerProfileDigest: Digest256;
}

export function deriveProviderExecutionProfile(
  input: ProviderExecutionProfileInput,
): Readonly<ProviderExecutionProfile>;

export function verifyProviderExecutionProfile(
  value: unknown,
): value is ProviderExecutionProfile;
```

- [ ] **Step 1: Write RED tests**

Tests must prove:

```ts
it('derives a stable provider profile identity', ...)
it('changes identity when provider/model/execution/normalizer/ABI changes', ...)
it('allows JEV and local Qwen to use different model assurance classes', ...)
it('rejects unknown providerKind at runtime even through any', ...)
it('rejects malformed digest or extra fields', ...)
```

Use exact provider fixtures:

```ts
const jev = {
  providerId: 'typesafe-system-one/jev-1.13.0',
  providerKind: 'jev-system-one',
  modelIdentityDigest: d('1'),
  modelAssurance: 'opaqueVersioned',
  executionSemanticsDigest: d('2'),
  normalizerDigest: d('3'),
  observationABIDigest: d('4'),
};

const qwen = {
  providerId: 'neo/qwen-ane',
  providerKind: 'qwen-ane',
  modelIdentityDigest: d('5'),
  modelAssurance: 'contentVerified',
  executionSemanticsDigest: d('6'),
  normalizerDigest: d('3'),
  observationABIDigest: d('4'),
};
```

- [ ] **Step 2: Push RED with Tasks 2 and 3 tests**

Expected: three new suites fail because new modules do not exist.

- [ ] **Step 3: Implement provider profile identity**

Use `digestTaggedIdentity('ANVIL.ProviderExecutionProfile.v1', ...)`.

Tagged fields:
1 providerId UTF-8
2 providerKind UTF-8
3 modelIdentityDigest raw 32 bytes
4 modelAssurance UTF-8
5 executionSemanticsDigest raw 32 bytes
6 normalizerDigest raw 32 bytes
7 observationABIDigest raw 32 bytes

Runtime validation:
- providerId non-empty, NUL-free
- providerKind from exact closed set
- assurance from exact closed set
- all digests canonical lower-case sha256
- exact object shape in verifier

- [ ] **Step 4: Export**

```ts
export * from './provider-profile.js';
```

- [ ] **Step 5: Focused verification**

```text
npm test -- --run tests/provider-profile.test.ts
npm run typecheck
npm run build
```

---

### Task 2: Promotion-issued provider-bound authority credential

**Files:**
- Create: `tests/promotion-credential.test.ts`
- Create: `src/lab/promotion-credential.ts`
- Modify: `src/lab/authority-registry.ts`
- Modify: `tests/authority-registry.test.ts`
- Modify: `tests/authority-router.test.ts`
- Modify: `src/lab/index.ts`

**Interfaces:**

```ts
export interface PromotionCredentialIssueInput {
  providerProfile: ProviderExecutionProfile;
  promotion: CalibrationPromotionResult;
  policyProfileDigest: Digest256;
  observationABIDigest: Digest256;
  sourceLineageDigest: Digest256;
  authorityGeneration: number;
}

export class PromotedAuthorityCredential {
  // constructor is issuer-token protected at runtime
  readonly schema: 'anvil.promoted-authority-credential.v1';
  readonly providerId: string;
  readonly providerProfileDigest: Digest256;
  readonly executionSemanticsDigest: Digest256;
  readonly calibrationIdentity: Digest256;
  readonly policyProfileDigest: Digest256;
  readonly observationABIDigest: Digest256;
  readonly authorityIdentity: Digest256;
  readonly promotionPolicyDigest: Digest256;
  readonly sourceLineageDigest: Digest256;
  readonly authorityGeneration: number;
  readonly credentialDigest: Digest256;
}

export class PromotionAuthorityIssuer {
  issue(
    input: PromotionCredentialIssueInput,
  ): Readonly<PromotedAuthorityCredential>;
}

export function verifyPromotedAuthorityCredential(
  value: unknown,
): value is PromotedAuthorityCredential;
```

**Authority identity:**

```ts
deriveAuthorityIdentity({
  calibrationIdentity: promotion.calibrationIdentity,
  policyProfileDigest,
  observationABIDigest,
})
```

**Credential identity** additionally binds:
- provider profile digest
- execution semantics digest
- promotion policy digest
- source lineage digest
- authority generation
- derived authority identity

- [ ] **Step 1: RED tests**

Must prove:

1. `REMAIN_SHADOW` promotion cannot mint a credential.
2. `CANARY_ELIGIBLE` promotion can mint a sealed/frozen credential.
3. same calibration/policy/ABI but different provider profile yields different credential digest.
4. tampering provider profile digest, calibration identity, or generation makes verifier fail.
5. plain structural object copied from a credential fails verification because it was not issued by the module issuer.
6. credential cannot be created from a `LocalHardwareReceipt` or measurement gate result.
7. Qwen provider profile cannot reuse a JEV credential.

- [ ] **Step 2: Refactor AuthorityRegistry**

Remove public mask registration.

New registry API:

```ts
export class AuthorityRegistry {
  registerCredential(
    credential: PromotedAuthorityCredential,
  ): AuthorityRouteGrant;

  resolve(
    routeId: string,
    sourceLineageDigest: string,
  ): AuthorityRouteGrant | null;
}
```

Route ID is derived deterministically:

```ts
const routeId =
  `authority:${credential.providerId}:${credential.authorityGeneration}`;
```

Registry rules:
- `verifyPromotedAuthorityCredential(credential)` must pass.
- duplicate route ID rejects.
- route grants expose only provider-bound promotion identity plus `calibrationAuthorized=true` and `policyProfileAuthorized=true`. They do NOT contain a `SemanticAuthorityMask`.
- `M_source`, `M_evidence`, and `M_recovery` remain per-lane runtime facts owned by evidence/recovery boundaries.
- registry never accepts a caller-defined mask.
- grant binds providerProfileDigest and calibrationIdentity for later inspection.

- [ ] **Step 3: Update router tests**

Tests create credentials through `PromotionAuthorityIssuer` and register them.

Keep deterministic route behavior:
1. if `evidenceDeficit=true` and mechanical recovery exists, hydrate
2. if `evidenceDeficit=true` and pristine evidence exists, pristine
3. primary credential route only when no evidence deficit is declared
4. pristine conservative route when primary authority is absent
5. compatible credential route
6. alternate credential route
7. unoptimized

A promotion credential establishes only the calibration/authority factors. It never asserts lane source/evidence/recovery. Unknown route IDs remain non-authoritative.

- [ ] **Step 4: Export**

```ts
export * from './promotion-credential.js';
```

- [ ] **Step 5: Focused verification**

```text
npm test -- --run tests/promotion-credential.test.ts tests/authority-registry.test.ts tests/authority-router.test.ts
npm run typecheck
npm run build
```

---

### Task 3: Provider-neutral comparison harness

**Files:**
- Create: `tests/provider-comparison.test.ts`
- Create: `src/lab/provider-comparison.ts`
- Modify: `src/lab/index.ts`

**Interfaces:**

```ts
export interface ProviderComparisonArm {
  profile: ProviderExecutionProfile;
  observationProfiles: ObservationProfiles;
  provider: MappedObservationProvider;
}

export interface ProviderComparisonArmResult {
  providerId: string;
  providerProfileDigest: Digest256;
  executionProfileDigest: Digest256;
  traceCount: number;
  receiptCount: number;
  pristineFallbacks: number;
  abstentions: number;
  referentialPresentations: number;
  evictions: number;
  fullPresentations: number;
  latencyMsTotal: number;
  semanticInputTokens: number | null;
  semanticOutputTokens: number | null;
  providerFailures: number;
  observationSetDigest: Digest256;
  runs: readonly ObservationReplayRun[];
}

export interface ProviderComparisonResult {
  schema: 'anvil.provider-comparison.v1';
  traceCount: number;
  arms: readonly ProviderComparisonArmResult[];
}

export async function compareObservationProviders(
  traces: readonly ReplayTrace[],
  cas: InMemoryCAS,
  thresholds: ObservationPolicyThresholds,
  arms: readonly ProviderComparisonArm[],
): Promise<Readonly<ProviderComparisonResult>>;
```

- [ ] **Step 1: RED tests**

Tests must prove:

1. identical semantic answers from JEV and Qwen profiles produce separate arm results and distinct profile identities.
2. every arm executes the same trace count and exact candidate corpus.
3. one provider throwing returns pristine fallback for that provider only; the other provider remains normal.
4. duplicate provider IDs or duplicate provider-profile digests reject before execution.
5. an arm whose `observationProfiles.execution_profile.digest` does not equal `profile.providerProfileDigest` rejects.
6. observation ABI digest mismatch rejects before provider execution.
7. no result contains `authorized`, credential, route grant, or production authority fields.
8. token usage sums only when all receipts report the relevant metric; otherwise the aggregate is null instead of fake zero.

Use deterministic fixture providers:
- envelope provider with fixed valid five-axis observations
- throwing provider
- malformed provider

- [ ] **Step 2: Implement comparison harness**

For each arm:
- validate profile
- validate unique providerId/profile digest
- ensure `observationProfiles.execution_profile.digest === profile.executionSemanticsDigest`
- ensure provider profile Observation ABI digest matches the campaign expected ABI digest
- execute traces independently via `runObservationOnlyArm`
- never let an exception in one arm prevent other arms from running
- aggregate from actual replay receipts and presentations
- compute `observationSetDigest` over ordered trace receipt observation-set digests

Disposition aggregation:
- `ABSTAIN`
- `KEEP_FULL` and pristine fallback presentations count as full
- `KEEP_REFERENCE` / current referential disposition counts as referential
- `EVICTED` counts as eviction

Provider failure count:
- receipts with non-null `error_code`

Latency:
- sum finite non-null receipt latencies

Token usage:
- if every receipt supplies non-null input tokens, sum them, otherwise null
- same rule for output tokens

Freeze all returned arrays/objects.

- [ ] **Step 3: Export**

```ts
export * from './provider-comparison.js';
```

- [ ] **Step 4: Full verification**

```text
npm test -- --run tests/provider-profile.test.ts tests/promotion-credential.test.ts tests/provider-comparison.test.ts tests/authority-registry.test.ts tests/authority-router.test.ts
npm test
npm run typecheck
npm run build
git diff --check
```

---

### Task 4: Exact-head closure and continuity

**Records:**
- GitHub Actions RED/GREEN evidence
- Drive current pointer
- ANVIL Active Pointers row 55
- provider-comparison cloud continuation note

- [ ] **Step 1: Preserve RED evidence**

Record:
- exact RED SHA
- workflow ID
- exact new suites failing
- inherited suites status

- [ ] **Step 2: Preserve GREEN evidence**

Require:
- exact GREEN SHA
- Ubuntu Node 20 success
- Ubuntu Node 22 success
- macOS Node 20 success
- macOS Node 22 success
- test files/test count
- typecheck success
- build success

- [ ] **Step 3: Update Drive**

Active pointer must name:
- integrated provider-comparison exact head
- workflow
- test total
- current Neo V2 worker request
- production port unauthorized
- moving sibling branches are nonblocking

- [ ] **Step 4: Local continuation remains independent**

Do not retarget a Neo worker already running the V2 measurement request merely because this cloud provider-comparison branch advances. Local hardware measurement and cloud comparison run in parallel. Integrate the local successor only after its exact receipt arrives.

- [ ] **Step 5: Next cloud wave**

After this plan is green, next cloud work is:
- per-provider calibration artifact registry
- promotion credential issuance from source-bound fitted calibration artifacts instead of generic promotion-result inputs
- provider-specific canary/shadow replay matrix
- compare JEV cloud measurements against Mavis/Qwen/ANE when their adapters/receipts exist
- no winner/ranking or production authority without empirical evidence
