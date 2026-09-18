# ANVIL / SIEVE Semantic Retention V0 Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the isolated Phase 1 cloud laboratory foundation: multi-OS CI, provider-neutral mapped decision types, fail-closed strict reassembly, and deterministic hard-root carving.

**Architecture:** The lab keeps semantic intent provider-neutral. `MappedDecisionContract` defines fixed candidate axes and request identities, `reassembleMappedObservations` converts provider-adapter output into a one-to-one typed observation set or a single `PRISTINE_FALLBACK`, and `carveHardRoots` extracts immutable output roots before any semantic step. No production ANVIL, SIEVE, ReCompress, or provider credential path is touched.

**Tech Stack:** TypeScript 5.7+, Node.js 20/22, Vitest 2, GitHub Actions on Ubuntu and macOS.

**Spec:** `docs/superpowers/specs/2026-09-17-anvil-sieve-semantic-retention-v0-design.md`

## Global Constraints

- Work only on `north/anvil-sieve-semantic-retention-v0`.
- Do not modify ANVIL, local-agent-gateway, SIEVE, ReCompress, Paseo, or runtime deployment surfaces.
- No provider credentials in required CI.
- Semantic question text is registry-owned/frozen; callers provide candidate data only.
- Reassembly must fail the entire semantic batch to `PRISTINE_FALLBACK` before policy evaluation on cardinality/key mismatch, malformed axes, duplicate/unknown IDs, or non-finite/out-of-range probabilities.
- Hard roots are exit status, stderr, first N stdout lines, and last N stdout lines.
- Hard roots are never truncated to fit a presentation budget; if they exceed budget, the candidate is pristine-ineligible for semantic trimming.
- No canonical evidence deletion.
- TDD is mandatory for behavior changes: failing test first, observe failure, minimal implementation, observe green.
- CI matrix is Ubuntu/macOS × Node 20/22 and runs `npm ci`, `npm run typecheck`, `npm test`, and `npm run build`.

---

### Task 1: Cloud matrix CI and RED test surface

**Files:**
- Create: `.github/workflows/lab-ci.yml`
- Create: `tests/mapped-contract.test.ts`
- Create: `tests/reassembler.test.ts`
- Create: `tests/hard-roots.test.ts`

**Interfaces:**
- Consumes: existing npm scripts from `package.json`.
- Produces: failing behavioral specification for `validateMappedDecisionRequest`, `reassembleMappedObservations`, and `carveHardRoots`, plus the four-axis cloud verifier.

- [ ] **Step 1: Add the CI workflow**

Create `.github/workflows/lab-ci.yml`:

```yaml
name: Semantic Retention Lab CI

on:
  push:
    branches:
      - north/anvil-sieve-semantic-retention-v0
  pull_request:
    paths:
      - "src/**"
      - "tests/**"
      - "package.json"
      - "package-lock.json"
      - "tsconfig*.json"
      - ".github/workflows/lab-ci.yml"

permissions:
  contents: read

jobs:
  verify:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest]
        node: [20, 22]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 2: Add the mapped-request RED tests**

Create `tests/mapped-contract.test.ts` importing `validateMappedDecisionRequest` from `../src/lab/mapped-contract.js`. Build one valid request fixture with one candidate and assert:

```typescript
expect(validateMappedDecisionRequest(validRequest)).toEqual({ ok: true });
```

Add focused negative tests asserting `ok: false` for:
- zero candidates;
- 65 candidates;
- duplicate `candidate_id`;
- malformed source digest;
- missing recovery ref on a referentially eligible candidate;
- non-deterministic candidate order;
- candidate with an unexpected field;
- request with an unexpected top-level field.

Each negative test names the one production invariant that would make it fail.

- [ ] **Step 3: Add the strict reassembler RED tests**

Create `tests/reassembler.test.ts` importing `reassembleMappedObservations` and define input IDs `["cand-0001", "cand-0002"]`.

The success case returns two complete observation tuples and expects:

```typescript
expect(result.kind).toBe("OBSERVATIONS");
```

Add one focused failure test for each:
- returned cardinality mismatch;
- key-set mismatch;
- duplicate candidate ID;
- unknown candidate ID;
- missing `evidence_sufficient`;
- missing `still_needed`;
- missing `full_content_needed`;
- missing `unresolved_evidence`;
- missing `recoverable`;
- NaN;
- positive Infinity;
- probability below 0;
- probability above 1;
- request ID mismatch.

Every failure expects:

```typescript
expect(result).toMatchObject({ kind: "PRISTINE_FALLBACK" });
```

Also add an out-of-order success case proving candidate ordering in the provider response is not trusted: a complete permutation is accepted and returned in original input order. "Out-of-order IDs" by itself is not a fallback because the invariant is set/cardinality identity, not provider ordering.

- [ ] **Step 4: Add the hard-root RED tests**

Create `tests/hard-roots.test.ts` importing `carveHardRoots`.

Test:
- exit status is always retained;
- every stderr line is retained;
- first N and last N stdout lines are retained with overlap de-duplicated;
- middle stdout is reported as omitted rather than silently lost;
- hard-root byte count is deterministic;
- budget exactly equal to hard-root bytes is eligible;
- budget one byte below hard-root bytes yields `PRISTINE`;
- pristine outcome returns the original stdout/stderr without truncated hard roots.

- [ ] **Step 5: Push the RED commit and verify expected failure**

Commit only CI + tests.

Expected GitHub Actions property: all matrix jobs fail because `src/lab/*` production modules do not yet exist. This is the required RED observation. If failure is caused by YAML syntax, dependency installation, or unrelated pre-existing breakage instead of missing feature modules, repair the test/CI setup until the failure is for the intended missing implementation.

---

### Task 2: Provider-neutral mapped contract validation

**Files:**
- Create: `src/lab/mapped-contract.ts`
- Create: `src/lab/types.ts`
- Create: `src/lab/index.ts`
- Modify: `src/index.ts`
- Test: `tests/mapped-contract.test.ts`

**Interfaces:**
- Consumes: raw `unknown` request values from replay/provider adapters.
- Produces:
  - `MAPPED_DECISION_REQUEST_SCHEMA = "anvil.mapped-decision-request.v0"`
  - `MAPPED_OBSERVATION_AXES`
  - typed `MappedDecisionRequest` and candidate/profile structures
  - `validateMappedDecisionRequest(value: unknown): MappedRequestValidationResult`

- [ ] **Step 1: Define the frozen axis/type vocabulary**

In `src/lab/types.ts`, define:
- `CandidateID` as string at the type level;
- five observation axis names;
- profile identity shape `{ id; version; digest }`;
- hard-root, semantic-view, candidate-view, shared-state, request, observation, and fallback result interfaces.

No provider name or System One field belongs in the semantic contract types.

- [ ] **Step 2: Implement exact structural validation**

In `src/lab/mapped-contract.ts`, validate with explicit key allowlists rather than permissive object casting.

Rules:
- exact schema value;
- non-empty request/source-run IDs;
- all four profile/contract identity objects contain only `id`, `version`, `digest`;
- digest grammar `^sha256:[0-9a-f]{64}$`;
- 1...64 candidates;
- candidate grammar `^cand-[A-Za-z0-9._-]{1,96}$`;
- strictly increasing lexical candidate order;
- no duplicate candidate IDs;
- exact candidate key set;
- non-negative integer byte counts / omitted bytes;
- `source_kind === "tool_result"`;
- recovery ref grammar `^cas:[A-Za-z0-9._:-]+$`;
- hard-root exit status integer;
- stderr/head/tail arrays contain strings only;
- semantic-view selected chunks contain strings only;
- no unexpected fields at validated layers.

Return `{ ok: true }` or `{ ok: false, code, detail }`; never throw for caller data.

- [ ] **Step 3: Export the lab module**

`src/lab/index.ts` exports lab types and functions. Root `src/index.ts` adds:

```typescript
export * from './lab/index.js';
```

- [ ] **Step 4: Run the mapped contract tests**

Expected: `tests/mapped-contract.test.ts` passes. Reassembler and hard-root tests remain RED until their production modules exist.

---

### Task 3: Strict fail-closed reassembler

**Files:**
- Create: `src/lab/reassembler.ts`
- Modify if needed: `src/lab/types.ts`
- Modify: `src/lab/index.ts`
- Test: `tests/reassembler.test.ts`

**Interfaces:**
- Consumes:
  - original `requestID: string`;
  - original ordered `candidateIDs: readonly string[]`;
  - untrusted provider-adapter response as `unknown`.
- Produces:
  - `{ kind: "OBSERVATIONS", observations: MappedCandidateObservation[] }`; or
  - `{ kind: "PRISTINE_FALLBACK", code: string, detail: string }`.

- [ ] **Step 1: Implement schema and request-ID validation**

Reject non-object payloads, unexpected top-level fields, incorrect schema, or request-ID mismatch before reading observations.

- [ ] **Step 2: Implement cardinality and key-set validation**

Require observations to be an array with exactly the input candidate count. Build a returned-ID set; reject duplicates, unknown IDs, or any input ID absent from the returned set.

- [ ] **Step 3: Implement exact five-axis validation**

Each observation object may contain only:
- `candidate_id`;
- `evidence_sufficient`;
- `still_needed`;
- `full_content_needed`;
- `unresolved_evidence`;
- `recoverable`.

Each axis must be exactly `{ noul: number }`, and `noul` must be finite and within inclusive `[0, 1]`.

Any violation returns one batch-level `PRISTINE_FALLBACK`. No partial observation list is returned.

- [ ] **Step 4: Restore canonical candidate order**

Provider-return order is non-authoritative. Once set/cardinality validation passes, return observations in the original `candidateIDs` order.

- [ ] **Step 5: Run strict reassembler tests**

Expected: all `tests/reassembler.test.ts` cases pass, including out-of-order complete responses and every fail-closed corruption case.

---

### Task 4: Deterministic hard-root carver

**Files:**
- Create: `src/lab/hard-roots.ts`
- Modify if needed: `src/lab/types.ts`
- Modify: `src/lab/index.ts`
- Test: `tests/hard-roots.test.ts`

**Interfaces:**
- Consumes:

```typescript
type HardRootInput = {
  exitStatus: number;
  stdout: string;
  stderr: string;
  headLines: number;
  tailLines: number;
  presentationBudgetBytes: number;
};
```

- Produces:
  - an eligible hard-root result with deterministic retained lines, omitted stdout byte count, and exact hard-root byte count; or
  - `{ kind: "PRISTINE", reason: "hard_roots_exceed_budget", stdout, stderr, exitStatus, hardRootBytes }`.

- [ ] **Step 1: Normalize lines without semantic interpretation**

Split stdout/stderr on LF, preserving line text and deterministic order. Do not use error regexes, provider calls, or semantic labels.

- [ ] **Step 2: Select head/tail roots**

Retain first `headLines` and last `tailLines` stdout line indexes. Union the indexes to avoid duplicate overlap. Retain all stderr lines and the exit status.

- [ ] **Step 3: Compute exact byte accounting**

Use UTF-8 byte counts via `Buffer.byteLength`. Count the serialized retained roots with one frozen local encoding function so identical inputs produce identical byte counts.

Also compute omitted stdout bytes from the exact omitted line spans.

- [ ] **Step 4: Enforce the budget without truncation**

If `hardRootBytes > presentationBudgetBytes`, return `PRISTINE` with original stdout/stderr. Never reduce stderr/head/tail to make it fit.

- [ ] **Step 5: Run hard-root tests and the full local-equivalent suite in cloud CI**

Expected commands on each matrix runner:

```text
npm ci
npm run typecheck
npm test
npm run build
```

All four matrix jobs must succeed on the exact Phase 1 head before Phase 1 is reported complete.

---

## Phase 1 verification checklist

Before closeout:

- [ ] Re-query fork main, upstream main, and lab branch head.
- [ ] Inspect the exact branch diff from `c6cc3a477e58b9ba5bbc2c7ceed76e96bc7836eb`.
- [ ] Confirm changed files are restricted to the approved lab branch/docs/CI/src/tests scope.
- [ ] Confirm no credential reference was added to CI.
- [ ] Confirm RED workflow evidence existed before production implementation.
- [ ] Confirm final matrix has four successful jobs: Ubuntu 20, Ubuntu 22, macOS 20, macOS 22.
- [ ] Confirm final `npm test` includes strict reassembler corruption cases.
- [ ] Confirm `npm run typecheck` and `npm run build` succeed.
- [ ] Record the exact final commit SHA and workflow run ID.
- [ ] Do not claim production readiness or port anything into ANVIL/SIEVE.
