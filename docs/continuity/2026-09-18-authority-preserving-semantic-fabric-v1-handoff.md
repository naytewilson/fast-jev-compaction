# Authority-Preserving Semantic Fabric V1 — Controller / Worker Handoff

**Captured:** 2026-09-18  
**Repository:** `naytewilson/fast-jev-compaction`  
**Owned branch:** `north/authority-preserving-semantic-fabric-v1`  
**Branch base:** `a1807d53ed5592d5ec24d5934c4e9198bfd0d70f`

## Purpose

This file is the durable GitHub-side reacquisition card for the successor JEV / Semantic Observation Fabric campaign.

It does not replace live GitHub/runtime authority. Re-query mutable refs before acting.

## Design

Written V1 spec:

`docs/superpowers/specs/2026-09-18-authority-preserving-semantic-fabric-v1-design.md`

Design-spec commit:

`0ee2914defa7b4e14ccc4597f568b75da50ca3df`

The spec carries the accepted architecture direction:

- no-stop task plane;
- fail-closed authority plane;
- self-healing calibration plane;
- Authority-Preserving Acceleration;
- Semantic Authority Mask Algebra;
- immutable EvidenceSlice + owning EvidenceStore resolver;
- provider-neutral RegisteredSemanticProgram / Observation ABI;
- deterministic active-lane shape packing + strict scatter/reassembly;
- CalibrationIdentity / AuthorityIdentity split;
- model identity assurance classes;
- STRONG vs WEAK calibration-label authority;
- autonomous replay/refit/shadow/canary/promotion/rollback;
- Authority Handoff Without Task Handoff;
- durable synchronous receipt spine + bounded async enrichment;
- Apple-owned-boundary zero-copy posture;
- local ANE exact-SHA handoff contract.

## Inherited source state

The successor branch was forked from:

`north/anvil-sieve-semantic-retention-v0@a1807d53ed5592d5ec24d5934c4e9198bfd0d70f`

That exact parent head had a successful GitHub Actions matrix:

`Semantic Retention Lab CI #57 / run 35297115176`

The parent branch is an active sibling-owned surface and may continue moving. Do not reset or force-push it from this V1 campaign.

## Drive OS continuity

Controller current pointer:

- title: `JEV Semantic Observation Fabric V1 - Controller Current Pointer - 2026-09-18`
- Drive ID: `1NLGFNFug9mOUVvsR93mdUKTJpHkXJ7DrZxPILixeUuw`
- folder: `30_SHARED_HANDOFF_BUS/00_CURRENT`

Worker/campaign request:

- title: `REQUEST - JEV Semantic Observation Fabric V1 Cloud-to-Local Campaign - 2026-09-18`
- request ID: `jev-semantic-fabric-v1-20260918-01`
- Drive ID: `151URcmISy_9c3uYOeSqrydy_R0z-4IfFmfbQlxq1-Mk`
- folder: `30_SHARED_HANDOFF_BUS/10_REQUESTS`

## Cloud-to-local continuation law

Cloud controller and cloud workers publish exact green Git SHAs.

When local evidence is required, the local worker must:

1. re-query the remote branch;
2. preserve dirty local work before checkout;
3. fetch/pull the requested exact SHA;
4. verify local HEAD equals that SHA;
5. execute only the assigned machine/ANE/runtime objective;
6. commit and push a successor exact SHA;
7. return a source-bound receipt with files, commands, tests, hardware/runtime evidence, and uncertainty.

The controller then reacquires that exact successor SHA and continues.

## Protected surfaces

This V1 campaign must not directly mutate:

- production ANVIL branches;
- production local-agent-gateway branches;
- SIEVE presentation activation;
- ReCompress production retention/storage;
- Paseo production runtime;
- production credentials;
- protected main branches.

A production port is a separate future design and review.

## Current workflow gate

The owner approved the architecture direction and requested full cloud + Drive OS implementation.

The written architectural spec is now committed and self-reviewed.

Per the architectural design workflow, implementation code begins after the owner reviews the written spec. The next controller action after that gate is to create the detailed implementation plan and then execute the cloud TDD waves continuously without arbitrary micro-stops.
