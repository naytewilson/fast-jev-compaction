# ANVIL / SIEVE Semantic Retention Replay Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the isolated semantic-retention laboratory from Phase 1 into a complete offline replay wave with exact CAS verification, pristine/deterministic/upstream/observation-only arms, synthetic dependency traps, metrics, and replay receipts.

**Architecture:** Canonical evidence remains source-bound and recoverable through a simulated content-addressed store. Replay arms operate only on immutable fixtures. Arm A presents pristine evidence; Arm B applies deterministic hard-root/referential reduction; Arm C reproduces upstream fast-jev retention semantics behind an injected observer; Arm D consumes provider-neutral mapped observations and applies deterministic policy. All outcomes feed one metrics engine and one receipt schema. No production SIEVE, ReCompress, ANVIL, Paseo, or provider credential path is modified.

**Tech Stack:** TypeScript 5.7+, Node.js 20/22, Vitest 2, Node `crypto`, GitHub Actions Ubuntu/macOS matrix.

**Spec:** `docs/superpowers/specs/2026-09-17-anvil-sieve-semantic-retention-v0-design.md`

## Global Constraints

- Work only on `north/anvil-sieve-semantic-retention-v0`.
- Starting source head for this wave: `1fcff6a187ceff8c9febc57bdbc5135fe350d064`.
- Upstream PR #18 is unmerged candidate evidence and was re-verified at `4bfc8c7db8a3e88a2f57639ad745a7865da5021e` before this plan.
- No production repository writes.
- No live provider credentials in required CI.
- No canonical evidence deletion.
- Exact recovery is mechanical, never semantic.
- Any digest mismatch or missing CAS object makes referential presentation ineligible.
- Any mapped-observation alignment failure returns pristine before policy evaluation.
- Metrics classify a replay arm as architectural failure when critical-evidence false eviction is non-zero or Jev efficiency ratio is below 1.0 when semantic-cost data exists.
- TDD required for all new behavior.
- Final verification requires all four GitHub Actions matrix jobs to pass `npm ci`, `npm run typecheck`, `npm test`, and `npm run build`.

---

### Task 1: Exact recovery manifest and simulated CAS

**Files:**
- Create: `tests/recovery.test.ts`
- Create: `src/lab/recovery.ts`
- Modify: `src/lab/types.ts`
- Modify: `src/lab/index.ts`

**Interfaces:**
- `sha256Digest(bytes: Uint8Array | string): string`
- `createRecoveryManifest(bytes, objectID): RecoveryManifest`
- `verifyRecoveryObject(manifest, bytes | undefined): RecoveryVerification`
- `InMemoryCAS.put(objectID, bytes)`
- `InMemoryCAS.get(objectID)`
- `InMemoryCAS.verify(manifest)`

**Tests:**
- exact source digest and byte count are stable;
- correct bytes verify;
- one-byte mutation fails;
- missing object fails;
- mismatched object ID cannot satisfy another manifest;
- recovery reference is `cas:<object-id>`;
- manifest verification never trusts caller-declared `recoverable`.

---

### Task 2: Replay core, Arm A, Arm B, and dependency traps

**Files:**
- Create: `tests/replay-baselines.test.ts`
- Create: `src/lab/replay.ts`
- Create: `src/lab/traps.ts`
- Modify: `src/lab/types.ts`
- Modify: `src/lab/index.ts`

**Interfaces:**
- `ReplayTrace` with source-bound candidates and critical evidence labels.
- `ReplayPresentation` describing `FULL | REFERENTIAL | EVICTED | PRISTINE_FALLBACK`.
- `runPristineArm(trace, cas): ReplayRun`
- `runDeterministicArm(trace, cas): ReplayRun`
- `dependencyTrapCorpus(): ReplayTrace[]`

**Deterministic Arm B rules:**
1. verify CAS manifest before reduction;
2. carve hard roots;
3. if recovery fails, keep full;
4. if hard roots exceed budget, keep full;
5. if nothing is omitted, keep full;
6. otherwise emit hard roots plus exact marker:
   `[sieve-evidence source=<digest> recovery=<ref> omitted_bytes=<n>]`.

**Required synthetic traps:**
- middle deprecation warning needed later;
- middle memory address needed later;
- stderr warning amid noisy stdout;
- original failure cause followed by later success;
- one changed path inside repetitive output;
- only provenance reference in a redundant-looking block;
- insufficient semantic view of omitted middle;
- missing or digest-mismatched recovery object.

---

### Task 3: Common metrics and architectural scoreboard

**Files:**
- Create: `tests/metrics.test.ts`
- Create: `src/lab/metrics.ts`
- Modify: `src/lab/types.ts`
- Modify: `src/lab/index.ts`

**Interfaces:**
- `evaluateReplay(trace, run, costs?): ReplayMetrics`
- `classifyReplay(metrics): "PASS" | "ARCHITECTURAL_FAILURE" | "UNSCORED"`

**Metric rules:**
- `criticalEvidenceFalseEvictions` increments whenever a critical labeled span is absent from direct model-visible presentation.
- A referential marker does not erase the false-eviction count if the critical span itself is omitted, because downstream recovery/reread was forced.
- `grossContextTokensSaved`, `semanticCostTokens`, `recoveryCostTokens`, `netTokenSavings`, and `jevEfficiencyRatio` follow the approved formulas.
- Non-zero critical-evidence false eviction => `ARCHITECTURAL_FAILURE`.
- With semantic-cost data, `jevEfficiencyRatio < 1.0` => `ARCHITECTURAL_FAILURE`.
- Without semantic-cost data, deterministic/pristine arms are `UNSCORED` for Jev economics but still receive safety metrics.

---

### Task 4: Arm C upstream-semantics comparator

**Files:**
- Create: `tests/upstream-arm.test.ts`
- Create: `src/lab/upstream-arm.ts`
- Modify: `src/lab/index.ts`

**Interfaces:**
- `UpstreamRetentionObserver` injected dependency returning `keepCall` and `keepResult` scores.
- `runUpstreamComparator(trace, cas, observer, threshold): Promise<ReplayRun>`

**Behavior:**
- preserve current upstream conceptual semantics: result retained at/above threshold; otherwise call retained at/above threshold yields truncated/referential result; below both yields presentation eviction;
- comparator is replay-only and never deletes CAS bytes;
- semantic observer receives upstream-style bounded state that does not include the full candidate result body;
- pinned/hard-root candidates remain visible;
- observer failure returns full/pristine;
- exact upstream PR #18 head is recorded as comparator provenance but no PR #18 code is copied blindly.

**Tests:**
- low scores can evict a candidate whose critical evidence exists only in omitted result, demonstrating the known sufficiency weakness;
- provider failure returns full;
- critical hard roots stay visible;
- CAS remains intact for every disposition.

---

### Task 5: Arm D observation-only SIEVE candidate simulator

**Files:**
- Create: `tests/observation-arm.test.ts`
- Create: `src/lab/observation-arm.ts`
- Create: `src/lab/receipt.ts`
- Modify: `src/lab/types.ts`
- Modify: `src/lab/index.ts`

**Interfaces:**
- `ObservationPolicyThresholds` supplied explicitly by a calibration fixture.
- `MappedObservationProvider` injected dependency that receives a validated mapped request and returns untrusted provider-adapter output.
- `runObservationOnlyArm(trace, cas, profiles, thresholds, provider): Promise<ReplayRun>`
- `createReplayReceipt(...): ReplayReceipt`
- `verifyReplayReceipt(receipt): boolean`

**Policy order:**
1. mechanical request construction/validation failure -> full/pristine;
2. provider exception -> full/pristine;
3. strict reassembly failure -> full/pristine;
4. `evidence_sufficient < floor` -> full/pristine;
5. `unresolved_evidence >= keepFull` -> full;
6. mechanical recovery unavailable -> full;
7. `full_content_needed >= keepFull` -> full;
8. `still_needed >= retain` -> referential hard-root view;
9. otherwise -> replay-only presentation eviction.

**Tests:**
- malformed/misaligned response never reaches policy;
- low sufficiency keeps full;
- unresolved evidence keeps full;
- recovery failure keeps full even when semantic recoverable is high;
- semantic `recoverable=1.0` cannot override mechanical CAS failure;
- referential view uses exact CAS marker;
- receipt digest changes if contract/profile/candidate/observation/disposition changes;
- no credential or arbitrary question text is present in receipt/request.

---

### Task 6: Corpus replay matrix and closeout evidence

**Files:**
- Create: `tests/replay-matrix.test.ts`
- Create: `src/lab/replay-matrix.ts`
- Modify: `src/lab/index.ts`
- Update: PR #1 body with exact RED/GREEN workflow evidence.

**Interfaces:**
- `runReplayMatrix(corpus, dependencies): Promise<ReplayMatrixReport>`

**Required assertions:**
- Arm A has zero critical-evidence false evictions on every trap.
- Arm B reports which traps force reread because critical evidence falls outside hard roots.
- Arm C exposes the upstream sufficiency weakness in at least one purpose-built trap.
- Arm D with conservative deterministic fixture observations has zero critical-evidence false evictions on the corpus.
- No arm mutates source bytes or CAS objects.
- Report includes per-arm bytes, false evictions, recovery needs, semantic token costs when supplied, and architectural classification.

**Verification:**
- Commit RED tests first and capture failed matrix workflow.
- Implement Tasks 1–6.
- Fresh final GitHub Actions run must have four successful matrix jobs.
- Record exact final head, run ID, per-file test counts, and full test total.
- Inspect PR changed filenames to ensure only lab/docs/tests/CI surfaces changed.
- Keep PR draft and explicitly marked DO NOT MERGE.
- Do not run live Jev until the offline replay matrix is green and an exact pinned execution profile is available.
