# Authority-Preserving Semantic Fabric V1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the immutable identity, evidence-view, and semantic-authority-mask substrate that every later Semantic Observation Fabric V1 wave depends on.

**Architecture:** Add three isolated laboratory modules under `src/lab`: public deterministic identity hashing, owning evidence-view resolution, and authority-mask algebra. These modules do not execute policy, touch production ANVIL/SIEVE/ReCompress, or perform provider egress. They are deliberately small so later compiler, packing, receipt, recalibration, and authority-routing waves can depend on stable interfaces.

**Tech Stack:** TypeScript 5.7, Node.js `node:crypto`, Vitest 2.1, existing lab `sha256:` digest convention, GitHub Actions macOS/Linux Node 20/22 matrix.

**Spec:** `docs/superpowers/specs/2026-09-18-authority-preserving-semantic-fabric-v1-design.md`

## Global Constraints

- Work only on `north/authority-preserving-semantic-fabric-v1`.
- Do not mutate production ANVIL, local-agent-gateway, SIEVE, ReCompress, Paseo, protected branches, or production credentials.
- Preserve the V0 failure behavior inherited from `a1807d53ed5592d5ec24d5934c4e9198bfd0d70f`.
- Use RED -> GREEN commits and preserve the failing RED workflow as evidence.
- Public identity hashes use SHA-256 with domain separation, one-byte tags, and 32-bit big-endian length prefixes.
- `CalibrationIdentity` and `AuthorityIdentity` are public deterministic identities, not authentication keys.
- Callers never supply their own current store generation/digest as validation authority.
- Evidence bytes are immutable for identity purposes; byte changes imply a different content identity.
- Tier/performance transformations may preserve or reduce authority but may not create any false -> true authority component.
- No semantic provider may mint `M_source`, `M_cal`, `M_auth`, or `M_recovery`.
- Required cloud verification remains `npm ci`, `npm run typecheck`, `npm test`, `npm run build` on macOS/Linux and Node 20/22.

---

## File Structure

### New files

- `src/lab/identity.ts`  
  Canonical tagged framing plus `CalibrationIdentity` and `AuthorityIdentity` derivation.

- `src/lab/evidence-view.ts`  
  `EvidenceSlice`, `VerifiedEvidenceSlice`, owning resolver contract, and an isolated in-memory evidence store for the lab.

- `src/lab/authority-mask.ts`  
  Independent source/evidence/calibration/authority/recovery masks, derived capabilities, and acceleration monotonicity checks.

- `tests/identity.test.ts`  
  Domain separation, component sensitivity, calibration/policy identity separation, and invalid digest rejection.

- `tests/evidence-view.test.ts`  
  Generation fencing, digest validation, overflow-safe bounds checks, missing-object behavior, and successful source-bound slice resolution.

- `tests/authority-mask.test.ts`  
  Capability derivation and proof that acceleration cannot widen authority.

### Modified files

- `src/lab/index.ts`  
  Export the three new modules after GREEN implementation.

No V0 replay/provider modules are modified in this foundation wave.

---

### Task 1: Public identity framing and split calibration/authority identities

**Files:**
- Create: `tests/identity.test.ts`
- Create: `src/lab/identity.ts`
- Modify: `src/lab/index.ts`

**Interfaces:**
- Consumes: canonical `sha256:<64 lowercase hex>` digests already used by the V0 lab.
- Produces:
  - `type Digest256 = string`
  - `interface CalibrationIdentityInput`
  - `interface AuthorityIdentityInput`
  - `deriveCalibrationIdentity(input): Digest256`
  - `deriveAuthorityIdentity(input): Digest256`
  - `digestTaggedIdentity(domain, components): Digest256`

- [ ] **Step 1: Write the failing identity tests**

Create `tests/identity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  deriveAuthorityIdentity,
  deriveCalibrationIdentity,
  digestTaggedIdentity,
} from '../src/lab/identity.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

const calibrationInput = {
  decisionContractDigest: d('1'),
  compiledProgramDigest: d('2'),
  executionSemanticsDigest: d('3'),
  modelIdentityDigest: d('4'),
  normalizerDigest: d('5'),
  trainingMerkleRoot: d('6'),
  holdoutMerkleRoot: d('7'),
  samplingPolicyDigest: d('8'),
  labelAuthorityPolicyDigest: d('9'),
  datasetGenerationDigest: d('a'),
  labelBindingDigest: d('b'),
  calibratorSpecDigest: d('c'),
  fittedParametersDigest: d('d'),
} as const;

describe('semantic fabric public identities', () => {
  it('derives a stable calibration identity and changes on any execution/calibration input', () => {
    const first = deriveCalibrationIdentity(calibrationInput);
    const second = deriveCalibrationIdentity(calibrationInput);
    const changed = deriveCalibrationIdentity({
      ...calibrationInput,
      fittedParametersDigest: d('e'),
    });

    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect(changed).not.toBe(first);
  });

  it('keeps policy changes out of CalibrationIdentity but inside AuthorityIdentity', () => {
    const calibrationIdentity = deriveCalibrationIdentity(calibrationInput);
    const a = deriveAuthorityIdentity({
      calibrationIdentity,
      policyProfileDigest: d('e'),
      observationABIDigest: d('f'),
    });
    const b = deriveAuthorityIdentity({
      calibrationIdentity,
      policyProfileDigest: d('0'),
      observationABIDigest: d('f'),
    });

    expect(b).not.toBe(a);
    expect(deriveCalibrationIdentity(calibrationInput)).toBe(calibrationIdentity);
  });

  it('domain-separates otherwise identical tagged material', () => {
    const components = [{ tag: 1, data: Buffer.from('same') }];
    expect(digestTaggedIdentity('ANVIL.CalibrationIdentity.v2', components))
      .not.toBe(digestTaggedIdentity('ANVIL.AuthorityIdentity.v2', components));
  });

  it('rejects malformed digest inputs instead of silently normalizing them', () => {
    expect(() => deriveCalibrationIdentity({
      ...calibrationInput,
      modelIdentityDigest: 'sha256:BAD',
    })).toThrow(/canonical sha256/i);
  });
});
```

- [ ] **Step 2: Push the RED test-only commit**

Commit only `tests/identity.test.ts` together with the other Task 2/3 RED tests from this foundation wave.

Expected GitHub Actions result: typecheck/test failure because `src/lab/identity.ts` does not exist yet.

- [ ] **Step 3: Implement canonical tagged public identities**

Create `src/lab/identity.ts`:

```ts
import { createHash } from 'node:crypto';

export type Digest256 = string;

export interface TaggedIdentityComponent {
  tag: number;
  data: Uint8Array;
}

export interface CalibrationIdentityInput {
  decisionContractDigest: Digest256;
  compiledProgramDigest: Digest256;
  executionSemanticsDigest: Digest256;
  modelIdentityDigest: Digest256;
  normalizerDigest: Digest256;
  trainingMerkleRoot: Digest256;
  holdoutMerkleRoot: Digest256;
  samplingPolicyDigest: Digest256;
  labelAuthorityPolicyDigest: Digest256;
  datasetGenerationDigest: Digest256;
  labelBindingDigest: Digest256;
  calibratorSpecDigest: Digest256;
  fittedParametersDigest: Digest256;
}

export interface AuthorityIdentityInput {
  calibrationIdentity: Digest256;
  policyProfileDigest: Digest256;
  observationABIDigest: Digest256;
}

const CANONICAL_SHA256 = /^sha256:[0-9a-f]{64}$/;

function digestBytes(value: Digest256): Uint8Array {
  if (!CANONICAL_SHA256.test(value)) {
    throw new TypeError('identity component must be canonical sha256');
  }
  return Buffer.from(value.slice('sha256:'.length), 'hex');
}

export function digestTaggedIdentity(
  domain: string,
  components: readonly TaggedIdentityComponent[],
): Digest256 {
  if (domain.length === 0) throw new TypeError('identity domain must be non-empty');

  const stream: Buffer[] = [Buffer.from(domain + '\0', 'utf8')];
  let previousTag = 0;
  for (const component of components) {
    if (!Number.isInteger(component.tag) || component.tag < 1 || component.tag > 255) {
      throw new TypeError('identity tags must be integers in 1...255');
    }
    if (component.tag <= previousTag) {
      throw new TypeError('identity tags must be strictly increasing');
    }
    previousTag = component.tag;

    const bytes = Buffer.from(component.data);
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.byteLength);
    stream.push(Buffer.from([component.tag]), length, bytes);
  }

  return 'sha256:' + createHash('sha256').update(Buffer.concat(stream)).digest('hex');
}

export function deriveCalibrationIdentity(input: CalibrationIdentityInput): Digest256 {
  const values = [
    input.decisionContractDigest,
    input.compiledProgramDigest,
    input.executionSemanticsDigest,
    input.modelIdentityDigest,
    input.normalizerDigest,
    input.trainingMerkleRoot,
    input.holdoutMerkleRoot,
    input.samplingPolicyDigest,
    input.labelAuthorityPolicyDigest,
    input.datasetGenerationDigest,
    input.labelBindingDigest,
    input.calibratorSpecDigest,
    input.fittedParametersDigest,
  ];

  return digestTaggedIdentity(
    'ANVIL.CalibrationIdentity.v2',
    values.map((value, index) => ({ tag: index + 1, data: digestBytes(value) })),
  );
}

export function deriveAuthorityIdentity(input: AuthorityIdentityInput): Digest256 {
  return digestTaggedIdentity('ANVIL.AuthorityIdentity.v2', [
    { tag: 1, data: digestBytes(input.calibrationIdentity) },
    { tag: 2, data: digestBytes(input.policyProfileDigest) },
    { tag: 3, data: digestBytes(input.observationABIDigest) },
  ]);
}
```

- [ ] **Step 4: Export identity primitives**

Append to `src/lab/index.ts`:

```ts
export * from './identity.js';
```

- [ ] **Step 5: Verify Task 1**

Run in CI/local worker:

```text
npm test -- --run tests/identity.test.ts
npm run typecheck
npm run build
```

Expected: identity tests PASS, typecheck/build PASS.

---

### Task 2: Owning evidence resolver with generation and provenance fencing

**Files:**
- Create: `tests/evidence-view.test.ts`
- Create: `src/lab/evidence-view.ts`
- Modify: `src/lab/index.ts`

**Interfaces:**
- Consumes: `Digest256` from `identity.ts`.
- Produces:
  - `EvidenceSlice`
  - `VerifiedEvidenceSlice`
  - `EvidenceResolutionError`
  - `InMemoryEvidenceStore.putObject(handle, bytes)`
  - `InMemoryEvidenceStore.advanceGeneration()`
  - `InMemoryEvidenceStore.resolve(slice)`

- [ ] **Step 1: Write the failing evidence-view tests**

Create `tests/evidence-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { InMemoryEvidenceStore } from '../src/lab/evidence-view.js';

const digest = (value: string) =>
  'sha256:' + createHash('sha256').update(value).digest('hex');

describe('EvidenceSlice resolver', () => {
  it('resolves a source-bound slice through the owning store', () => {
    const store = new InMemoryEvidenceStore(7);
    store.putObject('obj-1', 'abcdef');

    const resolved = store.resolve({
      objectHandle: 'obj-1',
      manifestGeneration: 7,
      sourceDigest: digest('abcdef'),
      offset: 2,
      length: 3,
    });

    expect(Buffer.from(resolved.bytes).toString('utf8')).toBe('cde');
    expect(resolved.sourceDigest).toBe(digest('abcdef'));
    expect(resolved.manifestGeneration).toBe(7);
  });

  it('rejects stale generations before semantic execution', () => {
    const store = new InMemoryEvidenceStore(2);
    store.putObject('obj-1', 'abcdef');

    expect(() => store.resolve({
      objectHandle: 'obj-1',
      manifestGeneration: 1,
      sourceDigest: digest('abcdef'),
      offset: 0,
      length: 1,
    })).toThrow(/stale_generation/);
  });

  it('rejects a caller-supplied digest that does not bind the object bytes', () => {
    const store = new InMemoryEvidenceStore(1);
    store.putObject('obj-1', 'abcdef');

    expect(() => store.resolve({
      objectHandle: 'obj-1',
      manifestGeneration: 1,
      sourceDigest: digest('different'),
      offset: 0,
      length: 1,
    })).toThrow(/digest_mismatch/);
  });

  it('uses overflow-safe bounds checks', () => {
    const store = new InMemoryEvidenceStore(1);
    store.putObject('obj-1', 'abcdef');

    expect(() => store.resolve({
      objectHandle: 'obj-1',
      manifestGeneration: 1,
      sourceDigest: digest('abcdef'),
      offset: 5,
      length: Number.MAX_SAFE_INTEGER,
    })).toThrow(/out_of_bounds/);
  });

  it('rejects missing objects', () => {
    const store = new InMemoryEvidenceStore(1);
    expect(() => store.resolve({
      objectHandle: 'missing',
      manifestGeneration: 1,
      sourceDigest: digest('abcdef'),
      offset: 0,
      length: 1,
    })).toThrow(/missing_object/);
  });
});
```

- [ ] **Step 2: Include this file in the same RED commit as Tasks 1 and 3**

Expected GitHub Actions result: failure because the new module does not exist.

- [ ] **Step 3: Implement the owning evidence resolver**

Create `src/lab/evidence-view.ts`:

```ts
import { createHash } from 'node:crypto';
import type { Digest256 } from './identity.js';

export interface EvidenceSlice {
  objectHandle: string;
  manifestGeneration: number;
  sourceDigest: Digest256;
  offset: number;
  length: number;
}

export interface VerifiedEvidenceSlice extends EvidenceSlice {
  objectLength: number;
  pin: string;
  bytes: Uint8Array;
}

export type EvidenceResolutionCode =
  | 'stale_generation'
  | 'missing_object'
  | 'digest_mismatch'
  | 'out_of_bounds';

export class EvidenceResolutionError extends Error {
  constructor(public readonly code: EvidenceResolutionCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'EvidenceResolutionError';
  }
}

function sha256(value: Uint8Array): Digest256 {
  return 'sha256:' + createHash('sha256').update(value).digest('hex');
}

function safeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export class InMemoryEvidenceStore {
  private readonly objects = new Map<string, Uint8Array>();

  constructor(private generation: number) {
    if (!safeInteger(generation)) throw new TypeError('generation must be a non-negative safe integer');
  }

  putObject(handle: string, value: Uint8Array | string): void {
    if (handle.length === 0) throw new TypeError('object handle must be non-empty');
    const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
    this.objects.set(handle, bytes);
  }

  advanceGeneration(): number {
    if (this.generation === Number.MAX_SAFE_INTEGER) {
      throw new RangeError('manifest generation exhausted');
    }
    this.generation += 1;
    return this.generation;
  }

  currentGeneration(): number {
    return this.generation;
  }

  resolve(slice: EvidenceSlice): VerifiedEvidenceSlice {
    if (slice.manifestGeneration !== this.generation) {
      throw new EvidenceResolutionError('stale_generation', 'slice generation is not current');
    }

    const object = this.objects.get(slice.objectHandle);
    if (!object) throw new EvidenceResolutionError('missing_object', slice.objectHandle);

    if (sha256(object) !== slice.sourceDigest) {
      throw new EvidenceResolutionError('digest_mismatch', 'slice digest does not bind object bytes');
    }

    if (!safeInteger(slice.offset) || !safeInteger(slice.length)) {
      throw new EvidenceResolutionError('out_of_bounds', 'offset/length must be non-negative safe integers');
    }

    if (slice.offset > object.byteLength || slice.length > object.byteLength - slice.offset) {
      throw new EvidenceResolutionError('out_of_bounds', 'slice exceeds object bounds');
    }

    return {
      ...slice,
      objectLength: object.byteLength,
      pin: `${slice.objectHandle}@${this.generation}`,
      bytes: object.subarray(slice.offset, slice.offset + slice.length),
    };
  }
}
```

- [ ] **Step 4: Export evidence-view primitives**

Append to `src/lab/index.ts`:

```ts
export * from './evidence-view.js';
```

- [ ] **Step 5: Verify Task 2**

Run:

```text
npm test -- --run tests/evidence-view.test.ts
npm run typecheck
npm run build
```

Expected: all evidence-view tests PASS.

---

### Task 3: Semantic Authority Mask Algebra and acceleration monotonicity

**Files:**
- Create: `tests/authority-mask.test.ts`
- Create: `src/lab/authority-mask.ts`
- Modify: `src/lab/index.ts`

**Interfaces:**
- Produces:
  - `SemanticAuthorityMask`
  - `SemanticCapabilities`
  - `deriveSemanticCapabilities(mask)`
  - `isAuthorityPreservingAcceleration(before, after)`
  - `assertAuthorityPreservingAcceleration(before, after)`

- [ ] **Step 1: Write the failing authority-mask tests**

Create `tests/authority-mask.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  assertAuthorityPreservingAcceleration,
  deriveSemanticCapabilities,
  isAuthorityPreservingAcceleration,
} from '../src/lab/authority-mask.js';

describe('Semantic Authority Mask Algebra', () => {
  it('separates observation, semantic, policy, and referential capabilities', () => {
    expect(deriveSemanticCapabilities({
      source: true,
      evidence: true,
      calibration: false,
      authority: false,
      recovery: true,
    })).toEqual({
      mayObserve: true,
      mayScoreSemantics: true,
      mayDrivePolicy: false,
      mayPresentReferentially: false,
    });
  });

  it('requires mechanical recovery in addition to policy authority for referential presentation', () => {
    expect(deriveSemanticCapabilities({
      source: true,
      evidence: true,
      calibration: true,
      authority: true,
      recovery: false,
    }).mayPresentReferentially).toBe(false);
  });

  it('allows an acceleration layer to preserve or reduce mask authority', () => {
    const before = {
      source: true,
      evidence: true,
      calibration: true,
      authority: true,
      recovery: true,
    };
    expect(isAuthorityPreservingAcceleration(before, {
      ...before,
      evidence: false,
      authority: false,
    })).toBe(true);
  });

  it('rejects any false-to-true mask transition by an acceleration layer', () => {
    const before = {
      source: true,
      evidence: true,
      calibration: false,
      authority: false,
      recovery: true,
    };
    const after = { ...before, calibration: true };

    expect(isAuthorityPreservingAcceleration(before, after)).toBe(false);
    expect(() => assertAuthorityPreservingAcceleration(before, after))
      .toThrow(/widen authority/i);
  });
});
```

- [ ] **Step 2: Include the test in the shared RED commit**

Expected: Actions fail until `authority-mask.ts` exists.

- [ ] **Step 3: Implement the mask algebra**

Create `src/lab/authority-mask.ts`:

```ts
export interface SemanticAuthorityMask {
  source: boolean;
  evidence: boolean;
  calibration: boolean;
  authority: boolean;
  recovery: boolean;
}

export interface SemanticCapabilities {
  mayObserve: boolean;
  mayScoreSemantics: boolean;
  mayDrivePolicy: boolean;
  mayPresentReferentially: boolean;
}

const FIELDS = [
  'source',
  'evidence',
  'calibration',
  'authority',
  'recovery',
] as const;

export function deriveSemanticCapabilities(mask: SemanticAuthorityMask): SemanticCapabilities {
  const mayObserve = mask.source;
  const mayScoreSemantics = mask.source && mask.evidence;
  const mayDrivePolicy =
    mask.source && mask.evidence && mask.calibration && mask.authority;
  return {
    mayObserve,
    mayScoreSemantics,
    mayDrivePolicy,
    mayPresentReferentially: mayDrivePolicy && mask.recovery,
  };
}

export function isAuthorityPreservingAcceleration(
  before: SemanticAuthorityMask,
  after: SemanticAuthorityMask,
): boolean {
  return FIELDS.every((field) => !after[field] || before[field]);
}

export function assertAuthorityPreservingAcceleration(
  before: SemanticAuthorityMask,
  after: SemanticAuthorityMask,
): void {
  if (!isAuthorityPreservingAcceleration(before, after)) {
    throw new Error('acceleration layer attempted to widen authority');
  }
}
```

- [ ] **Step 4: Export mask primitives**

Append to `src/lab/index.ts`:

```ts
export * from './authority-mask.js';
```

- [ ] **Step 5: Verify Task 3 and full inherited V0 regression**

Run:

```text
npm test -- --run tests/authority-mask.test.ts
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: all new tests PASS and all 105 inherited V0 tests remain green.

---

### Task 4: Exact-head cloud closure and continuation publication

**Files:**
- Modify: `docs/continuity/2026-09-18-authority-preserving-semantic-fabric-v1-handoff.md`
- Update: PR #2 body
- Update: Drive OS current pointer and campaign request after durable GitHub evidence exists.

**Interfaces:**
- Consumes: exact GREEN SHA and GitHub Actions workflow IDs.
- Produces: exact cloud pull target for downstream local agents and the next plan entrypoint.

- [ ] **Step 1: Record RED evidence**

Capture:
- RED commit SHA;
- failing Actions workflow ID(s);
- failing test names;
- confirmation that failure is caused by the intentionally absent modules.

Do not call unrelated infrastructure failures valid RED evidence.

- [ ] **Step 2: Record GREEN evidence**

Capture:
- GREEN commit SHA;
- exact parent SHA;
- macOS/Linux Node 20/22 workflow results;
- total test files/test count;
- `typecheck` result;
- `build` result;
- exact changed files.

- [ ] **Step 3: Re-query branch and PR #2**

Require:

```text
remote branch head == GREEN SHA
PR #2 head == GREEN SHA
PR #2 remains OPEN + DRAFT
production merge/deploy remains unauthorized
```

- [ ] **Step 4: Update durable continuity**

Update the GitHub handoff plus Drive OS current pointer/request only after the GREEN SHA and Actions evidence exist.

The next campaign plan after this foundation closes is the **Semantic Execution Plane**:

```text
RegisteredSemanticProgram / Observation ABI
-> exact lane ordinals
-> Active-Lane Shape Planner
-> strict gather/scatter
-> data-plane/control-plane split
```

- [ ] **Step 5: Commit/publish closeout**

The closeout receipt must use:

```text
PROVEN
MISSING EVIDENCE
POSSIBLY WRONG OR OVERSTATED
EXACT NEXT ACTION
WHAT DOES NOT COUNT AS COMPLETION
SAFE TO CONTINUE HERE OR START A FRESH CONTEXT
```

and include repo, branch, base/final SHA, workflow IDs, test totals, changed files, Drive IDs, and local-agent exact-pull target.
