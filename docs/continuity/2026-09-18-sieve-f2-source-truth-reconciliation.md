# Semantic Retention V0 — SIEVE F-2 Source-Truth Reconciliation

**Date:** 2026-09-18
**Scope:** durable controller context for the isolated `fast-jev-compaction` semantic-retention laboratory.
**Authority:** navigation/handoff only. Re-query GitHub before acting.

## Reconciled live source truth

The worker receipt supplied during the cloud campaign is useful execution evidence, but one mutable fact in it has already been superseded.

### local-agent-gateway

- Protected `main`: `b57c0c0e8a5269da0e4b440dd9e4811952a86da3`
- PR #53: OPEN, DRAFT, mergeable
- PR #53 accepted F-2 source head: `2bc074f0d367d077934c61c8c6bb155a9229d4db`
- Fresh independent controller review: issue comment `5723542199`
- Controller verdict on that exact head: **F-2 SOURCE ACCEPTED**
- PR #53 versus current main:
  - status: diverged
  - ahead: 5
  - behind: 4
  - merge base: `c5d18e253070fd3648d4142d8a2157fab14841e6`
- Hosted workflow runs on `2bc074f...`: none observed

The receipt's `main=d759c963...` statement was true for its execution window but is not current source truth. Main advanced through PR #55 to `b57c0c0...`.

## Accepted F-2 properties

The independent exact-head review accepts the source implementation for:

- explicit `RunSamplingBaseline` tri-state consumption;
- `.unknownRun` preserving stale continuation taxonomy instead of entering sampling comparison;
- `.unspecified` versus `.declared(let opener)` distinction;
- immutable opener sampling ownership across continuation;
- exact mismatch handling across Chat and Responses ingress;
- pre-SSE refusal;
- chained original-baseline behavior;
- digest binding for declared sampling;
- same normalized sampling reproducing the digest;
- changed sampling values/field sets changing the digest;
- fieldless-empty sampling normalizing to absent.

This acceptance is **not** merge authorization.

## F-2 landing gate still open

Before PR #53 can be considered for merge:

1. Re-query protected main.
2. Merge current main into `sieve/f2-continuation-sampling-20260917` without rewriting accepted F-2 commits.
3. Resolve only real conflicts. Do not redesign F-2.
4. Run focused F-2 tests plus current-main SIEVE ingress tests.
5. Run full serial + parallel validation, `git diff --check`, and `scripts/verify.sh`.
6. Explicitly inspect/grep for `Some test targets reported failures`.
7. If that diagnostic appears, rerun `AgentRuntimeBridgeTests` and fail the candidate until clean.
8. Push the exact integrated head for a fresh independent merge review.

The current `scripts/verify.sh` source does not itself grep that wrapper diagnostic. Do not claim that it does.

## Relationship to the JEV / semantic-retention laboratory

This changes **integration provenance**, not the laboratory architecture.

The lab remains isolated and MUST NOT:

- mutate `local-agent-gateway`, ANVIL, SIEVE, ReCompress, Paseo, or production runtime surfaces;
- treat PR #53 source acceptance as a deployed/merged capability;
- target the stale `d759c963...` gateway main in a future production-port prompt;
- assume F-2 is present on protected main until its synchronized candidate is independently accepted and merged.

Any future production-port design or worker prompt must re-query the then-current gateway main and PR #53 status. If F-2 is still unmerged, the port stays decoupled and must not depend on it.

## Current laboratory state at reconciliation

Repository: `naytewilson/fast-jev-compaction`
PR: #1, draft, DO NOT MERGE
Branch: `north/anvil-sieve-semantic-retention-v0`

Last fully green cloud head before the current TDD step:
`a45e8ea7f50ee242be33bb2b333ff311692c1107`

Cloud workflow:
`35295241331` — SUCCESS

Current TDD RED head:
`d77dcd77cd9af7064821aea8f45d7a30ac13d9df`

Cloud workflow:
`35295300666` — FAILURE by design while adding the pinned System One mapped-execution adapter.

Do not hand off `d77dcd77...` as a completed candidate. The controller must finish the GREEN implementation and rerun the full four-runner matrix first.

## Continuation law for Slack / fresh contexts

A continuation must reacquire, in this order:

1. this file;
2. `fast-jev-compaction` PR #1 exact head + Actions;
3. `local-agent-gateway` protected main;
4. PR #53 exact head/status and source-acceptance comment `5723542199`;
5. ANVIL JEV Decision Fabric PR #97 exact head/status;
6. Drive Active Pointers.

GitHub remains authority for committed mutable refs. Drive is coordination/evidence, not runtime proof.
