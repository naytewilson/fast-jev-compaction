# Semantic Observation Fabric V1 Execution Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the provider-neutral RegisteredSemanticProgram / Observation ABI plus deterministic active-lane shape planning and strict gather/scatter identity preservation on top of the green V1 authority substrate.

**Architecture:** Compile the frozen context-retention semantic intent into a source-bound RegisteredSemanticProgram, represent provider outputs through an Observation ABI that cannot encode policy execution, and plan source-valid lanes into deterministic shape buckets while carrying immutable candidate identity and authority masks. Reassembly rejects any ordinal/candidate/source mismatch before observations can reach later calibration or policy layers.

**Tech Stack:** TypeScript 5.7, Node.js, Vitest 2.1, existing `src/lab` mapped-contract primitives, V1 `identity.ts`, `evidence-view.ts`, and `authority-mask.ts`.

**Spec:** `docs/superpowers/specs/2026-09-18-authority-preserving-semantic-fabric-v1-design.md`

## Global Constraints

- Work only on `north/authority-preserving-semantic-fabric-v1`.
- Preserve the exact V0 mapped-contract semantics and five predicate axes.
- No caller-supplied arbitrary semantic question text.
- Semantic execution emits observations only, never `executed`, `authorized`, or side-effect outcomes.
- Physical packing order may change; semantic candidate identity and original ordinal may not.
- Only lanes with `M_source = 1` are eligible for the semantic execution planner.
- Packing/scattering is an Authority-Preserving Acceleration transform and therefore cannot widen any mask component.
- Provider adapters cannot mint source, calibration, authority, or recovery masks.
- No production ANVIL/SIEVE/ReCompress/local-agent-gateway/Paseo mutation.
- Use RED -> GREEN commits with exact GitHub Actions evidence.

---

## File Structure

### New files

- `src/lab/semantic-program.ts`  
  Frozen provider-neutral semantic program compiler for the existing context-retention contract.

- `src/lab/observation-abi.ts`  
  Observation-only ABI types and strict source/program/ordinal validation.

- `src/lab/lane-planner.ts`  
  Deterministic source-valid gather, token-shape bucketing, microbatch planning, and strict scatter reassembly.

- `tests/semantic-program.test.ts`
- `tests/observation-abi.test.ts`
- `tests/lane-planner.test.ts`

### Modified files

- `src/lab/index.ts`

No policy executor, calibration mutation, or SIEVE presentation logic is added in this plan.

---

### Task 1: Compile the frozen semantic contract into a RegisteredSemanticProgram

**Files:**
- Create: `tests/semantic-program.test.ts`
- Create: `src/lab/semantic-program.ts`
- Modify: `src/lab/index.ts`

**Interfaces:**
- Consumes: `ProfileIdentity`, `MAPPED_OBSERVATION_AXES`, `sha256Digest`.
- Produces:
  - `RegisteredSemanticPredicate`
  - `RegisteredSemanticProgram`
  - `compileContextRetentionProgram(decisionContract)`

- [ ] **Step 1: Write RED tests**

```ts
import { describe, expect, it } from 'vitest';
import { compileContextRetentionProgram } from '../src/lab/semantic-program.js';

const digest = (c: string) => 'sha256:' + c.repeat(64);

describe('RegisteredSemanticProgram compiler', () => {
  it('freezes the five context-retention predicates in canonical order', () => {
    const program = compileContextRetentionProgram({
      id: 'anvil.context-retention.v1',
      version: '0.1.0',
      digest: digest('a'),
    });

    expect(program.predicates.map((p) => p.id)).toEqual([
      'evidence_sufficient',
      'still_needed',
      'full_content_needed',
      'unresolved_evidence',
      'recoverable',
    ]);
    expect(program.predicates[0].requiresEvidenceSufficient).toBe(false);
    expect(program.predicates.slice(1).every((p) => p.requiresEvidenceSufficient)).toBe(true);
  });

  it('produces a stable compiled-program digest bound to the source contract', () => {
    const a = compileContextRetentionProgram({
      id: 'anvil.context-retention.v1',
      version: '0.1.0',
      digest: digest('a'),
    });
    const b = compileContextRetentionProgram({
      id: 'anvil.context-retention.v1',
      version: '0.1.0',
      digest: digest('b'),
    });

    expect(a.programDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(compileContextRetentionProgram(a.decisionContract).programDigest).toBe(a.programDigest);
    expect(b.programDigest).not.toBe(a.programDigest);
  });
});
```

- [ ] **Step 2: Commit/push the execution-plane RED tests together with Tasks 2 and 3**

Expected CI: the three new suites fail because their modules do not exist while inherited tests remain green.

- [ ] **Step 3: Implement the compiler**

```ts
import { MAPPED_OBSERVATION_AXES, type MappedObservationAxis, type ProfileIdentity } from './types.js';
import { sha256Digest } from './recovery.js';

export interface RegisteredSemanticPredicate {
  id: MappedObservationAxis;
  requiresEvidenceSufficient: boolean;
  semanticDefinition: string;
}

export interface RegisteredSemanticProgram {
  schema: 'anvil.registered-semantic-program.v1';
  id: 'anvil.context-retention.v1';
  version: '1.0.0';
  decisionContract: ProfileIdentity;
  observationABIVersion: 'anvil.semantic-observation-abi.v1';
  predicates: readonly RegisteredSemanticPredicate[];
  programDigest: string;
}

const DEFINITIONS: Record<MappedObservationAxis, string> = {
  evidence_sufficient: 'The bounded source view and shared state are sufficient to judge the registered retention predicates.',
  still_needed: 'The source-bound candidate carries information likely needed for the active mission.',
  full_content_needed: 'Replacing omitted source content with an exact reversible reference would materially reduce usefulness.',
  unresolved_evidence: 'The candidate contains unresolved failure, warning, contradiction, dependency, or verification evidence.',
  recoverable: 'The candidate appears semantically recoverable through its declared identity; mechanical recovery remains separately authoritative.',
};

export function compileContextRetentionProgram(
  decisionContract: ProfileIdentity,
): RegisteredSemanticProgram {
  const predicates = MAPPED_OBSERVATION_AXES.map((id) => ({
    id,
    requiresEvidenceSufficient: id !== 'evidence_sufficient',
    semanticDefinition: DEFINITIONS[id],
  }));

  const core = {
    schema: 'anvil.registered-semantic-program.v1' as const,
    id: 'anvil.context-retention.v1' as const,
    version: '1.0.0' as const,
    decisionContract,
    observationABIVersion: 'anvil.semantic-observation-abi.v1' as const,
    predicates,
  };

  return Object.freeze({
    ...core,
    predicates: Object.freeze(predicates.map((predicate) => Object.freeze(predicate))),
    programDigest: sha256Digest(JSON.stringify(core)),
  });
}
```

- [ ] **Step 4: Export the module**

Append:

```ts
export * from './semantic-program.js';
```

- [ ] **Step 5: Verify focused tests and typecheck**

```text
npm test -- --run tests/semantic-program.test.ts
npm run typecheck
npm run build
```

---

### Task 2: Define an observation-only ABI with strict lane identity

**Files:**
- Create: `tests/observation-abi.test.ts`
- Create: `src/lab/observation-abi.ts`
- Modify: `src/lab/index.ts`

**Interfaces:**
- Consumes: `SemanticAuthorityMask`, `MappedCandidateObservation`, `RegisteredSemanticProgram`.
- Produces:
  - `SemanticLaneIdentity`
  - `SemanticObservationEnvelope`
  - `ObservationABIValidationResult`
  - `validateSemanticObservationEnvelope(expected, value)`

- [ ] **Step 1: Write RED tests**

```ts
import { describe, expect, it } from 'vitest';
import { validateSemanticObservationEnvelope } from '../src/lab/observation-abi.js';

const digest = (c: string) => 'sha256:' + c.repeat(64);

const expected = {
  candidateId: 'cand-a',
  originalOrdinal: 3,
  sourceDigest: digest('a'),
  programDigest: digest('b'),
};

const valid = {
  schema: 'anvil.semantic-observation-abi.v1',
  ...expected,
  evidenceSufficient: 0.91,
  predicates: {
    stillNeeded: 0.8,
    fullContentNeeded: 0.2,
    unresolvedEvidence: 0.1,
    recoverable: 0.99,
  },
  telemetry: {
    entropy: null,
    margin: null,
  },
};

describe('Semantic Observation ABI', () => {
  it('accepts an exact observation-only lane envelope', () => {
    expect(validateSemanticObservationEnvelope(expected, valid)).toEqual({ ok: true });
  });

  it('rejects candidate, ordinal, source, or program identity drift', () => {
    for (const patch of [
      { candidateId: 'cand-other' },
      { originalOrdinal: 4 },
      { sourceDigest: digest('c') },
      { programDigest: digest('d') },
    ]) {
      expect(validateSemanticObservationEnvelope(expected, { ...valid, ...patch }).ok).toBe(false);
    }
  });

  it('rejects non-finite or out-of-domain probabilities', () => {
    expect(validateSemanticObservationEnvelope(expected, {
      ...valid,
      evidenceSufficient: Number.NaN,
    }).ok).toBe(false);

    expect(validateSemanticObservationEnvelope(expected, {
      ...valid,
      predicates: { ...valid.predicates, stillNeeded: 1.1 },
    }).ok).toBe(false);
  });

  it('has no policy execution field', () => {
    expect(validateSemanticObservationEnvelope(expected, {
      ...valid,
      authorized: true,
    }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Include in the shared RED commit**

- [ ] **Step 3: Implement exact-shape validation**

Implement a closed schema with these exact fields:

```ts
export interface SemanticLaneIdentity {
  candidateId: string;
  originalOrdinal: number;
  sourceDigest: string;
  programDigest: string;
}

export interface SemanticObservationEnvelope extends SemanticLaneIdentity {
  schema: 'anvil.semantic-observation-abi.v1';
  evidenceSufficient: number;
  predicates: {
    stillNeeded: number;
    fullContentNeeded: number;
    unresolvedEvidence: number;
    recoverable: number;
  };
  telemetry: {
    entropy: number | null;
    margin: number | null;
  };
}
```

Validation requirements:

- exact top-level keys only;
- exact predicate/telemetry keys only;
- exact equality for candidate ID, ordinal, source digest, program digest;
- ordinal is a non-negative safe integer;
- all probability values are finite in `[0,1]`;
- entropy/margin are either `null` or finite numbers;
- any policy/authority field causes rejection.

Use result:

```ts
type ObservationABIValidationResult =
  | { ok: true }
  | { ok: false; code: string; detail: string };
```

- [ ] **Step 4: Export the module**

```ts
export * from './observation-abi.js';
```

- [ ] **Step 5: Verify**

```text
npm test -- --run tests/observation-abi.test.ts
npm run typecheck
npm run build
```

---

### Task 3: Deterministic active-lane shape planner and strict scatter

**Files:**
- Create: `tests/lane-planner.test.ts`
- Create: `src/lab/lane-planner.ts`
- Modify: `src/lab/index.ts`

**Interfaces:**
- Consumes: `SemanticAuthorityMask`, `deriveSemanticCapabilities`.
- Produces:
  - `SemanticLane`
  - `SemanticMicrobatchConfig`
  - `PackedSemanticLane`
  - `SemanticMicrobatchPlan`
  - `planSemanticMicrobatches(lanes, config)`
  - `reassemblePackedLaneResults(plan, results)`

- [ ] **Step 1: Write RED tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  planSemanticMicrobatches,
  reassemblePackedLaneResults,
} from '../src/lab/lane-planner.js';

const digest = (c: string) => 'sha256:' + c.repeat(64);
const mask = (source: boolean) => ({
  source,
  evidence: false,
  calibration: false,
  authority: false,
  recovery: false,
});

describe('Active-Lane Shape Planner', () => {
  it('gathers only source-valid lanes and packs deterministically by bucket then ordinal', () => {
    const plan = planSemanticMicrobatches([
      { originalOrdinal: 0, candidateId: 'cand-a', sourceDigest: digest('a'), tokenEstimate: 60, mask: mask(true) },
      { originalOrdinal: 1, candidateId: 'cand-b', sourceDigest: digest('b'), tokenEstimate: 10, mask: mask(false) },
      { originalOrdinal: 2, candidateId: 'cand-c', sourceDigest: digest('c'), tokenEstimate: 10, mask: mask(true) },
      { originalOrdinal: 3, candidateId: 'cand-d', sourceDigest: digest('d'), tokenEstimate: 30, mask: mask(true) },
    ], { shapeBuckets: [16, 32, 64], maxBatchSize: 2 });

    expect(plan.packedLanes.map((lane) => lane.candidateId)).toEqual([
      'cand-c',
      'cand-d',
      'cand-a',
    ]);
    expect(plan.packedLanes.map((lane) => lane.originalOrdinal)).toEqual([2, 3, 0]);
  });

  it('reassembles exact packed results into original semantic ordinal order', () => {
    const plan = planSemanticMicrobatches([
      { originalOrdinal: 0, candidateId: 'cand-a', sourceDigest: digest('a'), tokenEstimate: 40, mask: mask(true) },
      { originalOrdinal: 1, candidateId: 'cand-b', sourceDigest: digest('b'), tokenEstimate: 10, mask: mask(true) },
    ], { shapeBuckets: [16, 64], maxBatchSize: 4 });

    const restored = reassemblePackedLaneResults(plan, [
      { packedIndex: 0, candidateId: 'cand-b', value: 'B' },
      { packedIndex: 1, candidateId: 'cand-a', value: 'A' },
    ]);

    expect(restored.map((result) => result.value)).toEqual(['A', 'B']);
  });

  it('fails closed on candidate identity drift during scatter', () => {
    const plan = planSemanticMicrobatches([
      { originalOrdinal: 0, candidateId: 'cand-a', sourceDigest: digest('a'), tokenEstimate: 1, mask: mask(true) },
    ], { shapeBuckets: [16], maxBatchSize: 1 });

    expect(() => reassemblePackedLaneResults(plan, [
      { packedIndex: 0, candidateId: 'cand-other', value: 'x' },
    ])).toThrow(/candidate identity mismatch/i);
  });

  it('rejects duplicate ordinals and duplicate candidate ids before packing', () => {
    expect(() => planSemanticMicrobatches([
      { originalOrdinal: 0, candidateId: 'cand-a', sourceDigest: digest('a'), tokenEstimate: 1, mask: mask(true) },
      { originalOrdinal: 0, candidateId: 'cand-b', sourceDigest: digest('b'), tokenEstimate: 2, mask: mask(true) },
    ], { shapeBuckets: [16], maxBatchSize: 2 })).toThrow(/duplicate ordinal/i);
  });
});
```

- [ ] **Step 2: Include in the shared RED commit**

- [ ] **Step 3: Implement deterministic planning**

Core behavior:

```ts
export interface SemanticLane {
  originalOrdinal: number;
  candidateId: string;
  sourceDigest: string;
  tokenEstimate: number;
  mask: SemanticAuthorityMask;
}

export interface SemanticMicrobatchConfig {
  shapeBuckets: readonly number[];
  maxBatchSize: number;
}

export interface PackedSemanticLane extends SemanticLane {
  packedIndex: number;
  shapeBucket: number;
}

export interface SemanticMicrobatch {
  shapeBucket: number;
  lanes: readonly PackedSemanticLane[];
}

export interface SemanticMicrobatchPlan {
  schema: 'anvil.semantic-microbatch-plan.v1';
  sourceLaneCount: number;
  packedLanes: readonly PackedSemanticLane[];
  batches: readonly SemanticMicrobatch[];
}
```

Rules:

- validate unique non-negative safe ordinals;
- validate unique non-empty candidate IDs;
- validate non-negative safe token estimates;
- validate sorted positive unique shape buckets and positive safe `maxBatchSize`;
- filter only `mask.source === true`;
- select the smallest configured bucket >= token estimate, otherwise use the token estimate as an explicit oversized bucket;
- sort by `shapeBucket`, then `originalOrdinal`;
- assign dense `packedIndex` values from zero;
- split equal buckets into deterministic microbatches of at most `maxBatchSize`;
- preserve the original `mask` object values unchanged.

Strict result reassembly must require:

- result count equals packed lane count;
- every packed index appears once;
- result candidate ID equals the planned candidate ID at that packed index;
- return values sorted by `originalOrdinal`.

- [ ] **Step 4: Export the module**

```ts
export * from './lane-planner.js';
```

- [ ] **Step 5: Verify full execution-plane wave**

```text
npm test -- --run tests/semantic-program.test.ts tests/observation-abi.test.ts tests/lane-planner.test.ts
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: inherited 118 foundation tests remain green plus all execution-plane tests.

---

### Task 4: Exact-head closure and next control-plane entrypoint

**Files:**
- Update: PR #2 evidence comment
- Update: Drive OS current pointer and Active Pointer row only after GREEN evidence.
- Add/modify continuity doc only if the exact refs materially change the next worker handoff.

- [ ] **Step 1: Preserve RED workflow evidence**

Record exact failing SHA/workflow and prove failure belongs only to missing new execution-plane modules.

- [ ] **Step 2: Preserve GREEN workflow evidence**

Require successful macOS/Linux Node 20/22 matrix on the exact implementation head or a source-equivalent descendant whose only additional change is CI configuration.

- [ ] **Step 3: Verify branch/PR equality**

Require remote branch head and PR #2 head to equal the reported successor SHA.

- [ ] **Step 4: Advance campaign**

Next plan is the Self-Healing Authority Plane:

```text
Durable Receipt Spine
-> CalibrationDatasetIdentity + STRONG/WEAK labels
-> RecalibrationCoordinator single-flight
-> immutable control-plane generations
-> AuthorityRouter
-> Authority Handoff Without Task Handoff
-> canary / atomic promotion / rollback
```

Production port remains unauthorized.
