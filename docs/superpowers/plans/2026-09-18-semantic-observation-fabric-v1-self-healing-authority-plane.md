# Semantic Observation Fabric V1 Self-Healing Authority Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the isolated lab control plane that durably binds minimum authority provenance, distinguishes strong from weak calibration evidence, self-heals compatible calibration drift through single-flight immutable generations, and hands authority routes over without changing task lineage.

**Architecture:** Keep semantic execution and policy authority structurally separate. The hot data plane continues to emit observation-only envelopes. The control plane consumes those observations through four focused modules: a synchronous append journal and bounded enrichment queue, calibration dataset/label identity, an immutable recalibration generation state machine with single-flight work, and a deterministic AuthorityRouter that preserves request lineage while choosing only currently authoritative routes.

**Tech Stack:** TypeScript 5.7, Node.js built-in `fs` and `crypto`, Vitest 2.1, existing V1 `identity.ts`, `authority-mask.ts`, `observation-abi.ts`.

**Spec:** `docs/superpowers/specs/2026-09-18-authority-preserving-semantic-fabric-v1-design.md`

## Global Constraints

- Work only on `north/authority-preserving-semantic-fabric-v1`.
- No production ANVIL/SIEVE/ReCompress/local-agent-gateway/Paseo mutation.
- No provider credential or live provider egress.
- The task plane must remain representable as continuing while semantic authority is degraded.
- A new model/profile cannot inherit calibration from old logits; later live replay must evaluate the new profile over source-bound STRONG labels.
- WEAK labels remain `calibration-authority:none`.
- Promotion swaps a complete immutable generation, never mutates active parameters in place.
- Concurrent recalibration for one target CalibrationIdentity collapses into one in-flight Promise.
- Consequential authority must not outrun the minimum receipt spine.
- Heavy enrichment may be shed under pressure; the receipt spine may not.
- Alternate providers are eligible only when they carry their own valid AuthorityIdentity.
- Use RED -> GREEN exact-head GitHub Actions evidence.

---

## File Structure

### New files

- `src/lab/receipt-spine.ts`  
  Synchronous durable JSONL authority journal plus bounded priority enrichment queue.

- `src/lab/calibration-data.ts`  
  STRONG/WEAK label authority, calibration dataset identity, and mechanically eligible label selection.

- `src/lab/recalibration.ts`  
  Immutable self-healing state machine, generation registry, transition validation, atomic promotion/rollback, and target-key single-flight coordinator.

- `src/lab/authority-router.ts`  
  Deterministic conservative routing and Authority Handoff Without Task Handoff.

- `tests/receipt-spine.test.ts`
- `tests/calibration-data.test.ts`
- `tests/recalibration.test.ts`
- `tests/authority-router.test.ts`

### Modified

- `src/lab/index.ts`

---

### Task 1: Durable synchronous receipt spine and bounded enrichment

**Files:**
- Create: `tests/receipt-spine.test.ts`
- Create: `src/lab/receipt-spine.ts`
- Modify: `src/lab/index.ts`

**Interfaces:**
- Produces:
  - `AuthorityReceiptSpineInput`
  - `AuthorityReceiptSpine`
  - `FileReceiptSpineJournal`
  - `ReceiptEnrichment`
  - `ReceiptEnrichmentQueue`

**Required behavior:**
- each append receives the minimum authority/provenance fields;
- journal allocates a monotonic 1-based sequence;
- receipt ID and digest are deterministic over canonical core fields plus sequence;
- append writes one JSON line and calls `fsyncSync` before returning;
- `readAll()` re-parses every line and rejects sequence gaps/digest mismatch;
- enrichment queue has finite capacity and priorities P1/P2/P3;
- P1 calibration evidence is never displaced by lower priority;
- under pressure, P3 debug is shed first, then P2 telemetry;
- queue pressure never touches journaled spine entries.

**RED tests:**
- append two spines, reopen file, verify sequence 1/2 and digest verification;
- tamper a stored line and require `readAll()` to fail;
- fill enrichment capacity with P2/P3 and prove P1 insertion evicts the lowest-priority oldest eligible item;
- prove lower-priority insertion is dropped rather than evicting P1.

Implementation should use a compact canonical JSON object and existing `sha256Digest`.

---

### Task 2: CalibrationDatasetIdentity and STRONG/WEAK label authority

**Files:**
- Create: `tests/calibration-data.test.ts`
- Create: `src/lab/calibration-data.ts`
- Modify: `src/lab/index.ts`

**Interfaces:**
- Produces:
  - `CalibrationLabelAuthority = 'STRONG' | 'WEAK'`
  - `CalibrationEvidenceLabel`
  - `CalibrationDatasetIdentityInput`
  - `deriveCalibrationDatasetIdentity(input)`
  - `selectAuthoritativeCalibrationLabels(labels)`

**Required behavior:**
- dataset identity binds training Merkle root, holdout Merkle root, sampling-policy digest, label-authority-policy digest, and dataset generation digest;
- train/holdout swaps change identity;
- WEAK labels are excluded from authoritative fit inputs;
- STRONG labels require source digest + outcome digest + verifier identity;
- label selection is deterministic by label ID and rejects duplicate IDs;
- output objects are frozen/copy-safe so callers cannot mutate an accepted authoritative set.

**RED tests:**
- identity changes when train/holdout split changes;
- mixed label set returns only STRONG labels in deterministic order;
- duplicate label ID fails closed;
- missing verifier identity on STRONG evidence fails closed.

Use `digestTaggedIdentity` from `identity.ts`.

---

### Task 3: Immutable self-healing recalibration generations and single-flight

**Files:**
- Create: `tests/recalibration.test.ts`
- Create: `src/lab/recalibration.ts`
- Modify: `src/lab/index.ts`

**Interfaces:**
- Produces:
  - `RecalibrationState`
  - `CalibrationGeneration`
  - `CalibrationGenerationRegistry`
  - `transitionCalibrationGeneration(current, nextState)`
  - `RecalibrationCoordinator.runSingleFlight(targetIdentity, work)`

**States:**
```text
ACTIVE
DEGRADED_SAFE
REPLAYING
FITTING
SHADOW_VALIDATING
CANARY
PROMOTING
ACTIVE_NEW_GENERATION
ROLLBACK
```

**Transition law:**
- ACTIVE -> DEGRADED_SAFE
- DEGRADED_SAFE -> REPLAYING
- REPLAYING -> FITTING
- FITTING -> SHADOW_VALIDATING
- SHADOW_VALIDATING -> CANARY or ROLLBACK
- CANARY -> PROMOTING or ROLLBACK
- PROMOTING -> ACTIVE_NEW_GENERATION or ROLLBACK
- ROLLBACK -> ACTIVE
- ACTIVE_NEW_GENERATION may normalize to ACTIVE as a separate immutable generation

No other transition is legal.

**Generation registry:**
- active generation object is deeply frozen at construction;
- `snapshot()` returns the current immutable generation;
- `promote(candidate)` requires state `ACTIVE_NEW_GENERATION`, generation exactly active+1, and swaps the whole object atomically;
- `rollback(previous)` only accepts a known previous generation and swaps the whole object;
- never mutate current generation fields in place.

**Single-flight:**
- same target identity while work is in flight returns the same Promise;
- worker function executes once;
- a different target may run independently;
- completed/failed job is removed so a later retry can run;
- failures propagate to every waiter.

**RED tests:**
- illegal transition fails;
- full happy transition chain works;
- promotion replaces the whole generation and prior snapshot remains unchanged;
- 25 concurrent calls for same target invoke work once and share result;
- two distinct target identities invoke work independently;
- rejected work clears single-flight so retry executes.

---

### Task 4: AuthorityRouter and Authority Handoff Without Task Handoff

**Files:**
- Create: `tests/authority-router.test.ts`
- Create: `src/lab/authority-router.ts`
- Modify: `src/lab/index.ts`

**Interfaces:**
- Produces:
  - `AuthorityRouteKind`
  - `AuthorityRouteCandidate`
  - `AuthorityRoutingRequest`
  - `AuthorityRoutingDecision`
  - `selectAuthorityRoute(request)`
  - `handoffAuthority(previous, next)`

**Conservative route order:**
1. direct primary only if `M_policy = 1`;
2. hydrate if source/evidence deficit is mechanically recoverable;
3. pristine/full evidence;
4. compatible previously validated profile with its own valid authority;
5. alternate provider with its own valid authority;
6. unoptimized continuation.

**Required behavior:**
- route selection never treats an uncalibrated alternate as safe;
- task/request ID and source lineage are identical across handoff;
- route generation increments by exactly one;
- handoff records previous/effective AuthorityIdentity and reason;
- any mismatch of request ID or source lineage fails closed;
- direct semantic optimization is impossible when `mayDrivePolicy=false`.

**RED tests:**
- invalid primary mask falls to pristine while keeping task alive;
- recoverable evidence deficit chooses hydrate before alternate provider;
- alternate without valid authority is skipped;
- validated alternate may be selected when pristine is unavailable;
- handoff preserves request/source lineage and increments route generation;
- mismatched lineage throws.

---

### Task 5: Cloud closure

**Files:**
- Update PR #2 controller evidence
- Update Drive current pointer and Active Pointer row after GREEN evidence

**Verification:**
```text
npm test
npm run typecheck
npm run build
git diff --check
```

Required exact-head Actions:
- Ubuntu 20
- Ubuntu 22
- macOS 20
- macOS 22

**Closeout records:**
- RED SHA + failing workflow IDs + proof that only new suites failed;
- GREEN SHA + successful push/PR workflow IDs;
- exact test file/test totals;
- exact changed files;
- next wave.

**Next wave after closeout:**
Degraded Evidence / Self-Healing Trial Harness + Counterfactual Regret Ledger integration + calibration metrics + fault injection, followed by exact-SHA local ANE execution-profile work.
