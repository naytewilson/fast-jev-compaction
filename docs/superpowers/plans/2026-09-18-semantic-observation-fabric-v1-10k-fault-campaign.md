# Semantic Observation Fabric V1 10K Fault Campaign Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Exercise the frozen degraded-trial ABI over 10,000 deterministic degraded cycles plus a pristine/full baseline without using fake hardware evidence.

**Architecture:** Add a deterministic synthetic campaign generator that covers every degraded scenario family, labels all timing as synthetic, never manufactures policy authority, and feeds the existing `evaluateDegradedTrial` evaluator unchanged. The campaign is scientific stress evidence for architecture logic only.

**Tech Stack:** TypeScript 5.7, Vitest 2.1.

**Spec:** `docs/superpowers/specs/2026-09-18-authority-preserving-semantic-fabric-v1-design.md`

## Constraints

- Exactly 10,000 cycles must have `shouldHavePolicyAuthority=false`.
- A separate FULL baseline cycle may be included and may have policy authority.
- Degraded cycles rotate deterministically across every non-FULL scenario.
- No degraded cycle may trigger policy in the safe campaign.
- Every degraded cycle keeps the task alive under conservative fallback.
- Timing values are synthetic and must remain marked `syntheticTiming=true`.
- Expected false-authority result: 10,000 opportunities, 0 leaks, observed FASR=1, approximate 95% FAR upper bound=0.0003.
- Verdict must be `PASS_SYNTHETIC`, never production clearance.
- A mutation probe that flips one degraded cycle to `policyTriggered=true` must produce `ARCHITECTURAL_FAILURE`.

## Files

- Create: `src/lab/fault-campaign.ts`
- Create: `tests/fault-campaign.test.ts`
- Modify: `src/lab/index.ts`

## RED

Write tests for:

1. `buildSyntheticFaultCampaign(10_000)` returns 10,001 cycles with exactly 10,000 no-authority opportunities and all 15 non-FULL degraded scenarios represented.
2. `evaluateDegradedTrial(campaign)` returns:
   - leaks 0
   - opportunities 10000
   - FASR 1
   - approximateFarUpper95 0.0003
   - `PASS_SYNTHETIC`
   - fallbackCoverageRetention 1
3. every degraded cycle has `syntheticTiming=true`, `fallbackActivated=true`, `taskCompleted=true`, and `policyTriggered=false`.
4. flipping one degraded cycle to policyTriggered produces `ARCHITECTURAL_FAILURE`.

Commit/push RED and preserve exact failing Actions.

## GREEN

Implement:

```ts
buildSyntheticFaultCampaign(degradedCycles: number): readonly DegradedTrialCycle[]
```

Rules:

- require positive safe integer;
- prepend one FULL baseline;
- rotate across all non-FULL scenario constants;
- create deterministic synthetic latencies from bounded ordinal arithmetic;
- include calibration probability/outcome pairs without claiming empirical calibration;
- freeze returned cycles/array.

Then run full cloud matrix.

## Closure

Publish exact RED/GREEN SHA/workflow/test totals to PR #2 and Drive current pointer. The next gate is the local execution-profile / hardware-measurement receipt ABI followed by exact-SHA Neo/ANE dispatch.
