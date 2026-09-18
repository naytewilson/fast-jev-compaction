# Semantic Observation Fabric V1 Trust-Boundary Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seal the remaining caller-mintable authority seams and harden the receipt/local-measurement ABIs before dispatching the exact V1 head to Neo for ANE measurement.

**Architecture:** Replace caller-supplied authoritative route candidates with grants issued by an owning `AuthorityRegistry`; upgrade the authority receipt spine to a closed, hash-chained V2 journal; and require local hardware receipts to embed a recomputable `LocalModelIdentity` rather than accepting a free-standing assurance claim. These changes stay entirely inside the isolated lab and preserve the no-stop task plane.

**Tech Stack:** TypeScript 5.7, Node.js built-in `crypto`/`fs`, Vitest 2.1, existing V1 identity/mask/router/receipt/local-profile modules.

**Spec:** `docs/superpowers/specs/2026-09-18-authority-preserving-semantic-fabric-v1-design.md`

## Global Constraints

- Work only on `north/authority-preserving-semantic-fabric-v1`.
- Current source-truth anchor before this plan: `9a331382cf10115751ebd1709296ffa11584ddc7`.
- Do not mutate production ANVIL, local-agent-gateway, SIEVE, ReCompress, Paseo, protected branches, or production credentials.
- A caller may identify a route but may not submit a mask that manufactures `M_auth`.
- Only an owning registry may return a policy-authoritative route grant.
- Receipt policy outcomes are closed vocabulary, not arbitrary strings.
- Every authority receipt after genesis must cryptographically bind the previous receipt digest.
- Local measurement receipts establish measured execution-profile evidence only and always carry `productionAuthorityGranted:false`.
- `contentVerified` model assurance must be internally recomputable from the exact model identity fields embedded in the receipt.
- Backend/runtime identity validation is fail-closed.
- Preserve RED -> GREEN workflow evidence and the macOS/Linux Node 20/22 matrix.
- Local ANE dispatch happens only after the hardened exact cloud head is green.

---

## File Structure

### New
- `src/lab/authority-registry.ts`
- `tests/authority-registry.test.ts`

### Modify
- `src/lab/authority-router.ts`
- `src/lab/receipt-spine.ts`
- `src/lab/execution-profile.ts`
- `src/lab/hardware-receipt.ts`
- `src/lab/local-profile-gate.ts`
- `src/lab/index.ts`
- `tests/authority-router.test.ts`
- `tests/receipt-spine.test.ts`
- `tests/execution-profile.test.ts`
- `tests/hardware-receipt.test.ts`
- `tests/local-profile-gate.test.ts`

---

### Task 1: Owning AuthorityRegistry and sealed route grants

**Interfaces:**
- Produces `AuthorityRegistry`, `AuthorityRouteGrant`, `AuthorityRegistrationInput`.
- `AuthorityRouteGrant` has a private constructor and can only be created by `AuthorityRegistry.register()`.
- `selectAuthorityRoute(request, registry)` consumes route IDs, not caller masks.

- [ ] **Step 1: Add RED tests**

Add `tests/authority-registry.test.ts` proving:
1. registering a valid policy-authoritative mask returns a frozen `AuthorityRouteGrant`;
2. registration rejects a mask where `mayDrivePolicy=false`;
3. resolution fails on source-lineage mismatch;
4. duplicate route IDs are rejected;
5. canonical authority/calibration/source-lineage digests are required.

Update `tests/authority-router.test.ts` so callers provide:

```ts
{
  primaryRouteId: 'jev-primary',
  compatibleProfileRouteIds: ['jev-old'],
  alternateProviderRouteIds: ['qwen-authoritative']
}
```

and route authority is obtained from the registry.

Add a test proving an unknown/forged route ID cannot become `primary`, `compatible-profile`, or `alternate-provider`.

- [ ] **Step 2: Push RED**

Expected failure: missing `authority-registry.ts` and router API mismatch only.

- [ ] **Step 3: Implement registry**

Create `src/lab/authority-registry.ts` with:

```ts
import { deriveSemanticCapabilities, type SemanticAuthorityMask } from './authority-mask.js';

export interface AuthorityRegistrationInput {
  routeId: string;
  calibrationIdentity: string;
  authorityIdentity: string;
  sourceLineageDigest: string;
  authorityGeneration: number;
  mask: SemanticAuthorityMask;
}

export class AuthorityRouteGrant {
  private constructor(
    public readonly routeId: string,
    public readonly calibrationIdentity: string,
    public readonly authorityIdentity: string,
    public readonly sourceLineageDigest: string,
    public readonly authorityGeneration: number,
    public readonly mask: Readonly<SemanticAuthorityMask>,
  ) {}

  static issue(input: AuthorityRegistrationInput): AuthorityRouteGrant {
    return new AuthorityRouteGrant(
      input.routeId,
      input.calibrationIdentity,
      input.authorityIdentity,
      input.sourceLineageDigest,
      input.authorityGeneration,
      Object.freeze({ ...input.mask }),
    );
  }
}

export class AuthorityRegistry {
  private readonly grants = new Map<string, AuthorityRouteGrant>();

  register(input: AuthorityRegistrationInput): AuthorityRouteGrant;
  resolve(routeId: string, sourceLineageDigest: string): AuthorityRouteGrant | null;
}
```

Runtime rules:
- all three identities are canonical sha256;
- route ID non-empty;
- generation non-negative safe integer;
- `deriveSemanticCapabilities(mask).mayDrivePolicy === true`;
- duplicate route ID fails closed;
- `resolve` returns only exact lineage matches.

- [ ] **Step 4: Refactor router**

`AuthorityRoutingRequest` carries route IDs instead of candidate objects.

`selectAuthorityRoute(request, registry)`:
- resolves primary through registry;
- hydrate/pristine remain deterministic no-authority routes;
- compatible/alternate arrays are traversed in declared deterministic order;
- unknown routes are skipped, not trusted;
- effective authority identity comes only from a resolved `AuthorityRouteGrant`.

- [ ] **Step 5: Verify**

```text
npm test -- --run tests/authority-registry.test.ts tests/authority-router.test.ts
npm run typecheck
npm run build
```

---

### Task 2: Hash-chained closed-vocabulary Authority Receipt Spine V2

**Interfaces:**
- `AuthorityPolicyOutcome` is exactly:
  `authorized | suppressed | hydrate | fallback | escalate | abstain | unoptimized`.
- Receipt schema becomes `anvil.authority-receipt-spine.v2`.
- Receipt adds `previousReceiptDigest`.
- `GENESIS_AUTHORITY_RECEIPT_DIGEST` is a stable canonical sha256 sentinel.
- `FileReceiptSpineJournal` verifies sequence + digest + previous-digest chain on every reopen.

- [ ] **Step 1: Add RED tests**

Update `tests/receipt-spine.test.ts` with:
1. second receipt `previousReceiptDigest === first.receiptDigest`;
2. third receipt binds second;
3. deleting/replacing a middle receipt and recomputing only that receipt is rejected by the following link;
4. unknown policy outcome is rejected;
5. `verifyAuthorityReceiptSpine` rejects wrong schema, non-canonical identities, invalid sequence, and a self-consistent-looking malformed object.

- [ ] **Step 2: Push RED**

Expected failure: V1 receipt schema lacks chain and outcome closure.

- [ ] **Step 3: Implement V2**

Use:

```ts
export const AUTHORITY_POLICY_OUTCOMES = [
  'authorized',
  'suppressed',
  'hydrate',
  'fallback',
  'escalate',
  'abstain',
  'unoptimized',
] as const;

export type AuthorityPolicyOutcome =
  (typeof AUTHORITY_POLICY_OUTCOMES)[number];

export const GENESIS_AUTHORITY_RECEIPT_DIGEST =
  sha256Digest('ANVIL.AuthorityReceiptSpine.Genesis.v2');
```

`buildReceipt(input, sequence, previousReceiptDigest)` includes the previous digest in the hashed core.

`readAll()` validates:

```text
sequence 1 -> previous = GENESIS
sequence N -> previous = receipt[N-1].receiptDigest
```

`verifyAuthorityReceiptSpine` calls full schema/input validation before digest comparison.

- [ ] **Step 4: Preserve queue behavior**

Do not change the already-corrected enrichment FIFO/priority behavior except to keep its tests green.

- [ ] **Step 5: Verify**

```text
npm test -- --run tests/receipt-spine.test.ts
npm run typecheck
npm run build
```

---

### Task 3: Recomputable local model identity and strict measurement receipt

**Interfaces:**
- Add `verifyLocalModelIdentity(identity)`.
- `LocalHardwareReceiptInput` accepts `modelIdentity: LocalModelIdentity` instead of a caller-supplied `modelIdentityDigest + modelAssurance` pair.
- Receipt persists a cloned model identity and derives the digest/assurance from it.
- `evaluateLocalProfileReceipt` checks the embedded model identity verifies and remains `contentVerified`.

- [ ] **Step 1: Add RED tests**

Update execution-profile tests:
- invalid runtime backend string passed through `as any` fails;
- changing model identity fields without changing `identityDigest` fails `verifyLocalModelIdentity`;
- a freshly derived model identity verifies.

Update hardware-receipt tests:
- receipt is created from `deriveLocalModelIdentity(...)`;
- mutating embedded model package/tokenizer/quantization invalidates verification;
- timestamp must be canonical `Date.toISOString()` form;
- duplicate shape `tokenBucket + batchSize` entries fail;
- shape records must be in deterministic `tokenBucket, batchSize` order.

Update local-profile-gate tests accordingly.

- [ ] **Step 2: Push RED**

Expected failure only in the new/changed strictness assertions.

- [ ] **Step 3: Implement model identity verification**

`verifyLocalModelIdentity` recomputes using:

```ts
deriveLocalModelIdentity({
  modelName,
  packageDigest,
  tokenizerDigest,
  weightsDigest,
  quantization,
  releaseId,
})
```

and requires exact identity digest and `assurance === 'contentVerified'`.

`deriveExecutionSemanticsDigest` must runtime-check backend against:

```ts
['coreml-ane', 'coreml-auto', 'cpu', 'remote']
```

- [ ] **Step 4: Harden hardware receipt**

Require:
- canonical ISO timestamp equality with `new Date(timestamp).toISOString()`;
- embedded verified `LocalModelIdentity`;
- deterministic unique shape-key ordering;
- receipt remains `productionAuthorityGranted:false`;
- receipt digest binds the complete embedded identity and measurements.

- [ ] **Step 5: Verify**

```text
npm test -- --run tests/execution-profile.test.ts tests/hardware-receipt.test.ts tests/local-profile-gate.test.ts
npm test
npm run typecheck
npm run build
git diff --check
```

---

### Task 4: Exact-head closure and Neo dispatch

**Files/records:**
- Update PR #2 evidence.
- Update GitHub continuity handoff.
- Update Drive current pointer and Active Pointer.
- Create dedicated Drive request: `REQUEST - Semantic Fabric V1 Neo ANE Measurement`.

- [ ] **Step 1: Preserve exact RED workflow evidence**
Record RED SHA, workflow ID, failing suites, and confirm inherited suites remain green.

- [ ] **Step 2: Preserve exact GREEN workflow evidence**
Require all four jobs green and capture exact test totals.

- [ ] **Step 3: Re-query branch/PR equality**
Require remote branch head == PR #2 head == reported GREEN SHA.

- [ ] **Step 4: Publish local worker contract**
The request must instruct the local agent to:
- preserve dirty work;
- fetch/pull exact GREEN SHA;
- verify local HEAD equals exact SHA;
- run on Neo/macOS/arm64/A18 Pro;
- measure the local Qwen/ANE execution profile through the frozen receipt ABI;
- hash package/tokenizer/weights and derive model/execution identities;
- measure route latency, observer latency, shape buckets, RSS, and ANVIL-owned-boundary copy behavior;
- produce a measured receipt with `productionAuthorityGranted:false`;
- run the gate;
- commit/push any lab-only tooling/receipt to an owned child branch;
- return exact successor SHA + machine receipt + tests;
- never activate production SIEVE/ReCompress authority.

- [ ] **Step 5: Continue cloud work**
While Neo measures, the cloud next plan is the provider-comparison harness:
JEV vs Mavis vs Qwen/ANE over one Observation ABI, with calibration identities kept provider-specific and no cross-provider authority transfer.
