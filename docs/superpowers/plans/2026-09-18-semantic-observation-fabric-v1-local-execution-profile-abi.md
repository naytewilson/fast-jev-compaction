# Semantic Observation Fabric V1 Local Execution Profile ABI Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Freeze the provider-neutral model/execution identity and measured hardware receipt ABI that a local Neo/ANE worker can populate after pulling an exact green cloud SHA.

**Architecture:** Performance evidence and semantic authority remain separate. A local worker can prove exact model/runtime identity and measured Core ML/ANE behavior, but that receipt only establishes a measured ExecutionProfile candidate. It does not create CalibrationIdentity or AuthorityIdentity. The cloud controller later binds verified measurements to calibration/replay evidence.

**Tech Stack:** TypeScript 5.7, Node.js, Vitest 2.1, existing V1 identity and receipt primitives.

**Spec:** `docs/superpowers/specs/2026-09-18-authority-preserving-semantic-fabric-v1-design.md`

## Global Constraints

- Cloud code must not claim ANE execution without a local measured receipt.
- A performance receipt may establish source/runtime/hardware/model provenance, never semantic policy authority.
- `contentVerified` requires content digests, not just a model name.
- Exact Git commit, branch, repo, OS/arch/hardware/runtime, and model package identity are mandatory.
- Timings must say `measured` or `synthetic`. Hardware acceptance requires `measured`.
- Local receipt must be digest-verifiable and contain no credential/token.
- Local worker must pull and verify the exact cloud SHA before measurement.
- No production SIEVE presentation activation.

---

## Files

- Create: `src/lab/execution-profile.ts`
- Create: `src/lab/hardware-receipt.ts`
- Create: `src/lab/local-profile-gate.ts`
- Create: `tests/execution-profile.test.ts`
- Create: `tests/hardware-receipt.test.ts`
- Create: `tests/local-profile-gate.test.ts`
- Modify: `src/lab/index.ts`

## Task 1: Model identity and execution semantics

Define:

```ts
type ModelIdentityAssurance =
  | 'contentVerified'
  | 'providerAttested'
  | 'opaqueVersioned'
  | 'unknown';

interface LocalModelIdentityInput {
  modelName: string;
  packageDigest: Digest256;
  tokenizerDigest: Digest256;
  weightsDigest?: Digest256;
  quantization: string;
  releaseId?: string;
}

interface ExecutionSemanticsInput {
  backend: 'coreml-ane' | 'coreml-auto' | 'cpu' | 'remote';
  runtimeVersion: string;
  compilerDigest: Digest256;
  contextWindow: number;
  quantization: string;
  samplingDigest: Digest256;
  hardwareSemanticsClass?: string;
}
```

Implement:

- `deriveLocalModelIdentity(input)` -> `{ assurance:'contentVerified', identityDigest, ... }`;
- identity changes on package/tokenizer/quantization/weights change;
- `deriveExecutionSemanticsDigest(input)` changes on backend/runtime/compiler/context/quantization/sampling/hardware semantics class;
- model identity and execution semantics remain separate inputs to CalibrationIdentity.

RED tests must prove each important component shifts its digest and malformed digests fail closed.

## Task 2: Hardware measurement receipt

Define a receipt that binds:

- schema/version
- receipt id/digest
- repo full name
- branch
- exact 40-hex commit SHA
- timestamp
- machine platform/arch/OS/hardware class
- accelerator/backend/runtime
- model identity digest + assurance
- execution semantics digest
- timing evidence kind
- route latency summary
- observer latency summary
- shape-bucket measurements
- peak RSS bytes when available
- explicit `productionAuthorityGranted:false`

Shape measurement:

```ts
{
  tokenBucket,
  batchSize,
  sampleCount,
  latencyMs: { p50, p95, p99 },
  itemsPerSecond
}
```

Implement:

- `createLocalHardwareReceipt(input)`
- `verifyLocalHardwareReceipt(receipt)`

Validation:

- finite non-negative timings;
- p50 <= p95 <= p99;
- positive sample count / batch / throughput;
- exact SHA syntax;
- contentVerified/local identity digest syntax;
- no field may claim production authority;
- receipt digest binds all measurements.

RED tests:
- valid measured receipt verifies;
- changing one latency breaks digest verification;
- synthetic timing remains syntactically valid but distinguishable;
- impossible percentile ordering is rejected.

## Task 3: Local measurement acceptance gate

Implement:

```ts
evaluateLocalProfileReceipt(receipt, expected)
```

Expected binds:

- repo
- branch
- exact commit SHA
- required platform `macOS`
- required arch `arm64`
- required accelerator `ANE`
- required timing evidence `measured`

Return:

```text
MEASUREMENT_ACCEPTED_NO_AUTHORITY
REJECTED
```

with reason codes.

It must reject:

- SHA mismatch;
- repo/branch mismatch;
- synthetic timing;
- non-ANE backend when ANE required;
- model assurance below contentVerified for the first local calibration campaign;
- invalid receipt digest.

Passing this gate still sets `productionAuthorityGranted=false`.

## Closure

After exact-head green Actions, publish the exact SHA as the Neo local-agent pull target and create the Drive OS request.

The local worker must measure actual hardware/runtime state and push any needed lab tooling/fixtures plus a machine receipt back to this same V1 branch or an explicitly owned local-child branch. It must not modify production repos.
