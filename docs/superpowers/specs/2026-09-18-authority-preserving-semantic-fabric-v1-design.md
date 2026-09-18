# ANVIL Authority-Preserving Semantic Fabric V1 Design

**Status:** approved architecture direction, isolated-laboratory implementation only  
**Repository:** `naytewilson/fast-jev-compaction`  
**Branch:** `north/authority-preserving-semantic-fabric-v1`  
**Base:** `a1807d53ed5592d5ec24d5934c4e9198bfd0d70f`  
**Production mutation:** forbidden by this spec

## 1. Objective

Evolve the current JEV semantic-retention laboratory into a production-shaped **Semantic Observation Fabric** that is fast, self-healing, provider-neutral, source-bound, replayable, and structurally incapable of widening decision authority through performance optimization.

The system must preserve the existing jurisdiction split:

- ContextLedger / immutable CAS owns canonical evidence bytes.
- ReCompress owns storage tier, retention lifetime, and rehydration.
- ContextPlanning owns candidate construction.
- Decision Fabric owns registered semantic contracts and typed observations.
- ExecutionProfile implementations such as JEV, Mavis, Qwen/ANE, or future providers execute semantic programs.
- CalibrationProfile owns empirical probability mapping for one exact execution identity.
- PolicyProfile owns deterministic interpretation and abstention rules.
- SIEVE owns model-visible presentation authority.
- PresentationAuthority owns the concrete one-use permission to present a candidate.

JEV remains a bounded semantic sensor. It never owns canonical deletion, source truth, presentation permission, ReCompress transitions, or side effects.

## 2. Prime doctrine

The fabric follows three simultaneous laws:

> **No-stop task plane.** Ordinary user work continues through conservative fallback when semantic optimization is degraded.

> **Fail-closed authority plane.** An observation whose provenance, sufficiency, calibration, or authority identity is invalid has zero policy authority.

> **Self-healing calibration plane.** Compatible model/runtime drift is repaired automatically by source-bound replay, refit, shadow validation, canary, atomic promotion, and rollback.

These laws are not optional performance modes. They define V1 correctness.

## 3. Authority-Preserving Acceleration Law

For any performance transformation `T` applied to a semantic lane:

```text
Authority(T(x)) subset-of Authority(x)
```

unless `T` is an explicit authority-generation transition backed by:

- new source-bound calibration evidence;
- an immutable new CalibrationIdentity;
- an immutable new AuthorityIdentity;
- validation against held-out evidence;
- an accepted canary result;
- a durable receipt spine;
- atomic generation promotion.

In practical terms:

- Tier-0 screening may suppress or defer work but cannot grant authority.
- active-lane packing may change physical execution order but cannot change semantic lane identity;
- zero-copy views may reduce copying but cannot weaken provenance;
- caching may reuse verified observations but cannot widen the authority attached to them;
- async enrichment may defer heavy telemetry but cannot defer the minimum durable authority receipt;
- quantization, batching, provider routing, or hardware acceleration cannot create a 0 -> 1 authority transition;
- only the dedicated authority-control plane can promote authority.

## 4. Semantic Authority Mask Algebra

A single epistemic bit is insufficient. V1 carries independent authority facts per candidate lane.

```text
M_source
  source/view is live, in-bounds, provenance-valid, and generation-valid

M_evidence
  evidence is sufficient to evaluate the registered semantic predicate

M_cal
  current observation probability is covered by an active calibrated profile

M_auth
  current PolicyProfile + Observation ABI authorize this calibrated observation

M_recovery
  exact mechanical recovery is currently available for referential presentation
```

Derived capability masks:

```text
M_observe      = M_source

M_semantic     = M_source AND M_evidence

M_policy       = M_source AND M_evidence AND M_cal AND M_auth

M_referential  = M_policy AND M_recovery
```

Consequences:

- a new model may still produce shadow observations when `M_cal = 0`;
- those observations may feed recalibration, but they have zero live policy authority;
- exact recoverability is not semantic. `M_recovery` is established mechanically;
- a semantic provider cannot mint or upgrade any mask component;
- capability masks are recomputed from owning authorities, never accepted from a caller.

This mask algebra is a reusable primitive for retention, retrieval, completion, review, search stopping, escalation, memory admission, and other source-bound semantic decisions.

## 5. Data plane and control plane separation

V1 does not place the full hot path behind a single actor or coordinator.

### 5.1 Data plane

The data plane contains:

- EvidenceStoreResolver
- Tier0DeficitGate
- ActiveLaneShapePlanner
- SemanticBatchExecutor
- StrictReassembler
- ObservationEmitter

It is highly parallel and returns observations plus mask-relevant evidence. It does not execute policy.

### 5.2 Control plane

The control plane contains:

- SemanticRuntimeRegistry
- CalibrationRegistry
- AuthorityRegistry
- AuthorityRouter
- RecalibrationCoordinator
- PromotionController
- RollbackController
- ReceiptJournal

It manages immutable generations and authority transitions.

### 5.3 Structural boundary

`SemanticBatchExecutor` may emit:

```text
candidate_id
ordinal
registered predicate values
evidence sufficiency
entropy telemetry
margin telemetry
model/effective execution identity
provider usage
latency
observation digest
```

It may not emit an "executed" policy result.

Observation-state vocabulary:

```text
observationProduced
evidenceDeficit
sourceInvalid
shadowOnly
providerFailed
```

Authority-decision vocabulary belongs to the deterministic authority plane:

```text
authorized
suppressed
hydrate
fallback
escalate
abstain
```

This makes the semantic sensor versus execution-authority distinction mechanical rather than conventional.

## 6. Evidence views and zero-copy boundaries

### 6.1 Immutable evidence identity

Canonical evidence identity is content-derived. Storage handles are not provenance.

```text
CASObjectHandle   !=   SourceDigest
```

The CAS object bytes are immutable. If bytes differ, the object is a different content identity.

A generation normally refers to the active ledger/manifest/namespace mapping, not mutable bytes.

### 6.2 EvidenceSlice

An input lane carries an inert immutable reference:

```swift
public struct EvidenceSlice: Sendable, Equatable {
    public let objectHandle: CASObjectHandle
    public let manifestGeneration: UInt64
    public let sourceDigest: Digest256
    public let offset: UInt64
    public let length: UInt64
}
```

The caller does not supply a "current generation" or "current digest" to validate itself.

### 6.3 Owning resolver

The EvidenceStore owns validation:

```swift
func resolve(_ slice: EvidenceSlice) throws -> VerifiedEvidenceSlice
```

The resolver checks:

- object exists;
- manifest generation is live;
- source digest binds the object identity;
- offset <= object size;
- length <= object size - offset;
- a stable pin/lease is established for the duration of semantic evaluation.

Failure yields a source-invalid lane. It never falls through into semantic authority.

### 6.4 Zero-copy definition

V1 promises **zero-copy at ANVIL-owned boundaries**, not an unverifiable claim that Core ML, ANE, GPU, or a remote provider never repacks buffers internally.

ANVIL components pass immutable views and source references without repeated JSON/deep-copy materialization where a local backend can consume shared storage.

Backends may materialize internally according to their own requirements.

## 7. Registered Semantic Program and Observation ABI

### 7.1 Semantic Contract Compiler

A provider-neutral DecisionContract compiles into a RegisteredSemanticProgram rather than free-form prompt text.

The compiler emits:

- state schema validator;
- candidate schema validator;
- lane dispatcher;
- frozen predicate definitions;
- sufficiency-gate semantics;
- provider-adapter descriptors;
- strict reassembly schema;
- Observation ABI schema;
- receipt codec schema;
- calibration identity inputs;
- replay-harness bindings.

Callers may provide data. They may not provide arbitrary question semantics.

### 7.2 Observation ABI

The Observation ABI is the provider-independent output boundary.

A lane observation includes:

```text
candidate_id
original_ordinal
observation_abi_version
program_digest
source_digest
evidence_sufficient
registered predicate outputs
telemetry summary
provider/effective model identity
observation_digest
```

Provider-specific adapters must map their native responses into this ABI before deterministic policy sees them.

### 7.3 Provider implementations

The same compiled semantic contract may target:

- TypeSafe System One / JEV;
- Mavis;
- Qwen/ANE;
- future local classifiers;
- future remote providers.

Provider selection does not change semantic intent.

## 8. Hierarchical sufficiency probing

### 8.1 Tier-0 is one-sided

Tier-0 is a deterministic or separately qualified accelerator for hard deficits only.

Examples:

- empty evidence;
- missing required source field;
- invalid EvidenceSlice;
- unavailable mandatory recovery ref;
- impossible schema;
- source identity mismatch;
- deterministic byte-budget violation.

Tier-0 may produce:

```text
HARD_DEFICIT
UNKNOWN
```

It does not grant semantic sufficiency in V1.

### 8.2 Tier-1 semantic sufficiency

Only active source-valid lanes reach the registered semantic predicate `evidence_sufficient`.

Entropy, margin, disagreement, and distance telemetry may be captured as auxiliary signals. They do not independently grant sufficiency authority.

A low-entropy wrong answer is still wrong.

### 8.3 Deficit routing

A deficit is routed deterministically to one of:

- hydrate missing source evidence;
- use pristine/full presentation;
- use a previously validated compatible authority profile;
- use an alternate provider only if that provider has its own valid AuthorityIdentity;
- escalate to a stronger observer in shadow mode;
- abstain.

An uncalibrated model is never called a "safe fallback."

## 9. Active-Lane Shape Compaction

The physical execution optimizer is provider/hardware neutral.

### 9.1 Logical packing

Given source-valid active mask:

```text
lanes:  [A B C D E]
mask:   [0 1 0 1 1]
gather: [B D E]
```

Every packed lane carries:

```text
original_ordinal
candidate_id
source_digest
```

The strict reassembler restores original semantic ordering after execution.

### 9.2 Determinism

Packing sort order is deterministic, for example:

```text
(token_shape_bucket, original_ordinal)
```

Physical reordering may never change semantic correspondence.

### 9.3 SemanticMicrobatchPlanner

Inputs:

- compiled semantic program;
- ExecutionProfile;
- active mask;
- token/byte shape estimate;
- evidence locality;
- provider/hardware capability profile;
- latency budget.

Outputs:

- deterministic microbatch groups;
- permutation/scatter map;
- batch identity digest.

For local ANE execution, static-shape buckets may use sizes such as 16/32/64/128 tokens only after hardware measurement proves those buckets appropriate. The architecture does not promise "100% SIMD utilization."

## 10. CalibrationIdentity and AuthorityIdentity

These are public deterministic identities, not secret cryptographic keys.

### 10.1 Canonical framing

Identity input is serialized with:

- explicit domain separator;
- one-byte field tag;
- 32-bit big-endian field length;
- canonical field bytes.

Example:

```text
DOMAIN = "ANVIL.CalibrationIdentity.v2\0"

01 | len | DecisionContractDigest
02 | len | CompiledProgramDigest
...
```

The identity is:

```text
SHA256(domain || tagged_fields)
```

HKDF is reserved for actual key derivation, not public identity hashing.

### 10.2 CalibrationIdentity

The calibration identity binds probability meaning:

```text
CalibrationIdentity = H(
  DecisionContractDigest,
  CompiledProgramDigest,
  ExecutionSemanticsDigest,
  ModelIdentity,
  NormalizerDigest,
  CalibrationDatasetIdentity,
  LabelBindingDigest,
  CalibratorSpecDigest,
  FittedParametersDigest
)
```

### 10.3 CalibrationDatasetIdentity

This identity includes:

- training-set Merkle root;
- holdout-set Merkle root;
- sampling-policy digest;
- label-authority-policy digest;
- dataset generation.

A changed train/holdout split therefore creates a different identity even when raw examples are the same.

### 10.4 AuthorityIdentity

Policy authority binds:

```text
AuthorityIdentity = H(
  CalibrationIdentity,
  PolicyProfileDigest,
  ObservationABIDigest
)
```

A policy-threshold change invalidates AuthorityIdentity without pretending that the underlying calibration curve itself became invalid.

## 11. Model identity assurance

ModelIdentity carries both identity and assurance class.

Suggested classes:

```text
contentVerified
providerAttested
opaqueVersioned
unknown
```

Examples:

Local Qwen/ANE may bind:

- weights SHA-256;
- tokenizer SHA-256;
- Core ML package SHA-256;
- quantization;
- compiler/runtime;
- execution-semantics digest.

Remote JEV may bind:

- provider;
- exact pinned model name;
- provider release identity if available;
- effective model echoed by response;
- adapter protocol version.

The policy may permit different authority levels for different assurance classes. It must not pretend a provider version string is equivalent to verified local weights.

## 12. Self-healing invalidation classes

### 12.1 NON_SEMANTIC

Execution-semantics fingerprint unchanged.

Examples:

- metadata-only packaging change;
- documentation release bump;
- provider release metadata change with identical verified execution semantics.

Action:

- keep current calibration and authority;
- record observation of metadata drift;
- no replay required.

### 12.2 SOFT_SEMANTIC

Contract and label semantics are unchanged, but execution semantics changed.

Examples:

- model weights bump;
- quantization change;
- runtime numeric/compiler change;
- provider model revision;
- tokenizer change.

Action:

- live task immediately uses a currently authoritative conservative route;
- new profile may produce shadow observations;
- autonomous source-bound replay/refit starts;
- no human required for ordinary compatible recovery.

### 12.3 HARD_SEMANTIC

Predicate meaning, contract schema semantics, Observation ABI semantics, or label binding changed.

Action:

- live task continues on conservative baseline;
- old calibration authority is not transferred;
- automatic corpus reuse is limited to labels whose semantics remain mechanically compatible;
- create a new semantic program generation;
- no user task halt;
- explicit code deployment/review may still be required for a new contract definition.

## 13. Authority Handoff Without Task Handoff

A request retains one task lineage while authority routes change.

Example:

```text
request R / generation 18

JEV K42 authorized
        |
model/profile drift
        v
pristine deterministic fallback
        |
recalibration succeeds
        v
JEV K43 authorized
```

The request identity, source identity, and provenance lineage remain continuous.

Receipts record:

- requested semantic profile;
- observed CalibrationIdentity;
- requested AuthorityIdentity;
- effective AuthorityIdentity;
- effective authority route;
- authority generation;
- fallback reason;
- promotion generation if one occurs.

Changing authority route does not restart the logical task.

## 14. Autonomous recalibration pipeline

### 14.1 Counterfactual Regret Ledger

The ledger stores source-bound outcomes from prior observations and downstream verification.

Label classes:

**STRONG**

- deterministic verifier;
- exact source-bound counterfactual result;
- mechanically proven recovery result;
- explicit human adjudication.

**WEAK**

- model self-report;
- agent success claim;
- heuristic judgment;
- unverified task completion.

Only STRONG labels can produce calibration-authoritative profiles.

WEAK evidence may support research/training candidates but is marked:

```text
calibration-authority:none
```

### 14.2 New-model replay requirement

Old logits alone cannot calibrate a changed model.

For a SOFT_SEMANTIC transition, the autonomous worker:

1. selects mechanically eligible STRONG historical labels;
2. resolves exact source evidence;
3. replays the **new** execution profile on those examples;
4. fits a calibration candidate;
5. evaluates a held-out set;
6. compares against the current champion;
7. enters shadow mode;
8. enters bounded canary;
9. atomically promotes on pass;
10. automatically rolls back on regression.

### 14.3 Single-flight

Recalibration jobs are keyed by target CalibrationIdentity.

Concurrent drift traffic attaches to one job instead of launching duplicate fits.

The coordinator supports:

- single-flight;
- debounce;
- cancellation;
- backpressure;
- minimum evidence count;
- generation fencing;
- bounded retries;
- replay checkpointing;
- crash recovery;
- automatic rollback.

## 15. Control-plane state machine

Immutable state generations:

```text
ACTIVE
  |
  | semantic drift
  v
DEGRADED_SAFE
  |
  +----------> live conservative route continues
  |
  v
REPLAYING
  |
  v
FITTING
  |
  v
SHADOW_VALIDATING
  |
  +---- fail ----> DISCARD / remain DEGRADED_SAFE
  |
  v
CANARY
  |
  +---- regress --> ROLLBACK
  |
  v
PROMOTING
  |
  v
ACTIVE_NEW_GENERATION
```

Promotion is atomic.

Readers observe one immutable generation or another. They never observe partially installed parameters.

The previous active generation remains rollbackable until the new generation passes its post-promotion stability window.

## 16. Durable Receipt Spine

### 16.1 Minimum synchronous spine

Before a consequential policy consumer acts, the system durably appends a compact receipt spine containing at minimum:

```text
receipt_id
monotonic_sequence
request_id
source_digest
decision_contract_digest
compiled_program_digest
observation_digest
calibration_identity
requested_authority_identity
effective_authority_identity
authority_route
authority_generation
policy_outcome
timestamp
receipt_digest
```

The critical law:

> policy authority never outruns its minimum recoverable provenance.

The implementation may use a preallocated append journal, microbatch group commit, CRC/digest framing, and monotonic sequence numbers. It does not require heavyweight full enrichment before action.

### 16.2 Async enrichment

Heavy telemetry is off-path:

- raw distribution blobs;
- logit traces;
- token usage;
- entropy/margin telemetry;
- provider trace;
- timing spans;
- debug captures.

Large blobs are content-addressed and referenced, not held indefinitely in process memory.

### 16.3 Enrichment priority

Suggested queue policy:

```text
P0 source/provenance identity        mandatory
P1 calibration labels               high priority
P2 logits/margins/usage             bounded
P3 verbose traces/debug blobs        best effort
```

The synchronous spine is never dropped.

Debug enrichment may degrade under pressure without weakening authority evidence.

## 17. Fallback routing

The deterministic fallback ladder is:

1. hydrate exact missing evidence if recoverable;
2. use pristine/full evidence;
3. use an existing compatible validated semantic profile;
4. use an alternate provider only if that provider has its own valid AuthorityIdentity;
5. otherwise continue without semantic optimization.

A mismatch therefore usually costs more context, tokens, or latency. It does not produce unauthorized semantic action.

## 18. Performance and Apple-platform posture

### 18.1 Unified memory

Apple Silicon unified memory is exploited where local APIs permit shared immutable views, but the architecture only guarantees zero-copy across ANVIL-owned boundaries.

### 18.2 ANE/Core ML

The local backend may use:

- static-shape microbatch buckets;
- model specialization by token/feature shape;
- precompiled Core ML programs;
- bounded queues;
- hardware-specific ExecutionProfile identities.

Any quantization/compiler/runtime change changes ExecutionSemanticsDigest when it can affect probabilities.

### 18.3 Actor placement

Actors own control-plane state transitions and registries.

The high-throughput batch data path must not be serialized behind one global actor.

### 18.4 Measurement over promises

No architecture claim promises:

- 100% SIMD utilization;
- zero internal Core ML copies;
- <=2 ms model inference;
- <=500 ms total recalibration.

Those are measured experimental properties, not correctness contracts.

## 19. Latency and calibration metrics

### 19.1 Fallback latency

Measure separately:

```text
T_detect
T_route
T_first_useful_result
T_fallback_complete
```

A preliminary target may be:

```text
p99(T_detect + T_route) <= 2 ms
```

only when actual runtime measurements support it.

### 19.2 Recalibration latency

Measure:

```text
T_select
T_replay
T_fit
T_validate
T_canary
T_promote
T_total_recovery
```

A <=500 ms target may be useful for `T_fit` of cheap calibrators. It is not a universal authority-restoration requirement.

### 19.3 Calibration quality

Track:

- ECE;
- Brier score;
- NLL;
- threshold-local calibration;
- selective risk/coverage;
- False Authority Rate;
- fallback coverage retention;
- exact recovery rate;
- reread/rehydration rate;
- semantic token economics;
- wall-clock latency;
- provider cost.

No universal `Delta ECE >= 0.15` rule exists.

### 19.4 False authority

For degraded trials report both observed and statistical statements.

Example with zero leaks in 10,000 trials:

```text
observed FASR = 100%
observed authority leaks = 0 / 10,000
approximate 95% FAR upper bound ~= 3 / N
```

The system never represents a finite test as proof that true FAR is mathematically zero.

## 20. Degraded Evidence and Self-Healing Trial

The lab must eventually exercise:

```text
FULL
PARTIAL
HEAD_TAIL
CONTRADICTORY
IRRELEVANT
ABSENT
MODEL_BUMP
QUANTIZATION_SHIFT
NORMALIZER_SHIFT
CALIBRATION_POISON_ATTEMPT
DUPLICATE_RECALIBRATION_STORM
CANARY_REGRESSION
ROLLBACK
STALE_EVIDENCE_VIEW
RECEIPT_ENRICHMENT_PRESSURE
PROVIDER_IDENTITY_DOWNGRADE
```

Required properties include:

- masked lanes never gain policy authority;
- hard deficits never invoke a policy-authoritative semantic result;
- source-invalid lanes fail before semantic authority;
- packing/scattering preserves exact candidate identity;
- uncalibrated new-model observations remain shadow-only;
- fallback route keeps task lineage alive;
- duplicate recalibration demand collapses into single-flight;
- weak labels never become calibration-authoritative;
- failed canary atomically rolls back;
- stale EvidenceSlice is rejected;
- async enrichment pressure cannot drop the durable receipt spine;
- alternate providers cannot inherit another provider's calibration.

## 21. Semantic invention ledger carried into V1

The branch preserves these experimental primitives for explicit study:

### 21.1 Epistemic-Masked Semantic SIMD

One registered semantic program maps across many source-bound candidates while retaining exact lane identity, epistemic validity, provenance, and deterministic authority.

### 21.2 Semantic Contract Compiler / Observation ABI

Semantic intent compiles into portable validation, adapter, reassembly, calibration, receipt, and replay machinery rather than ad hoc prompts.

### 21.3 Calibration Fence / Identity Split

Probability mapping and downstream policy authority have separate immutable identities.

### 21.4 Semantic Authority Mask Algebra

Operations receive capabilities from independent source/evidence/calibration/authority/recovery facts instead of one confidence score.

### 21.5 Counterfactual Regret Ledger

Future verified outcomes are joined back to prior semantic decisions to generate source-bound calibration and regret evidence.

### 21.6 Authority Handoff Without Task Handoff

Task lineage survives semantic authority-route changes.

### 21.7 Authority-Preserving Acceleration

Performance transforms are forbidden from widening authority.

These are experimental architectural primitives, not patentability claims.

## 22. Relationship to existing lab V0

This V1 branch inherits the verified V0 mechanisms and metrics, including:

- provider-neutral mapped requests;
- strict response reassembly;
- exact probability-domain validation;
- deterministic hard roots;
- complete tool-evidence recovery binding;
- replay Arms A/B/C/D;
- dependency-trap corpus;
- false-eviction accounting;
- token-economics accounting;
- full replay receipts;
- exact pinned JEV adapter;
- synthetic egress grants;
- macOS/Linux cloud CI.

V1 may refactor these mechanisms to fit the stronger architecture but must preserve or strengthen their failure behavior.

## 23. Production boundaries

This branch MUST NOT:

- write into production ANVIL, local-agent-gateway, SIEVE, ReCompress, or Paseo;
- activate production presentation;
- mint real SIEVE authority;
- store production provider credentials;
- claim live ANE performance without local hardware evidence;
- treat Drive as repository authority;
- treat worker narrative as proof of GitHub or runtime state;
- merge into protected production branches from this experiment.

A future production port requires a separate integration design and exact-head independent review.

## 24. Cloud-to-local handoff law

Cloud work produces durable exact refs.

Local workers must:

1. re-query the branch;
2. verify the requested exact SHA exists;
3. preserve any dirty local work before checkout;
4. fetch/pull the exact ref;
5. verify local HEAD equals the requested SHA;
6. run local/hardware work inside owned boundaries;
7. commit and push a successor exact SHA;
8. return a receipt with changed files, commands/tests, hardware/runtime evidence, and remaining uncertainty.

The controller then re-acquires the pushed exact SHA and independently verifies the resulting source/CI evidence.

## 25. Initial V1 implementation decomposition

The eventual implementation should be split into independently reviewable waves:

1. typed identity primitives and canonical framing;
2. EvidenceSlice + EvidenceStore resolver simulation;
3. Semantic Authority Mask Algebra;
4. RegisteredSemanticProgram / Observation ABI compiler surface;
5. deterministic lane ordinal + packing/scatter planner;
6. data-plane/control-plane split;
7. durable receipt spine + bounded enrichment queue;
8. CalibrationDatasetIdentity and strong/weak label authority;
9. self-healing recalibration state machine and single-flight coordinator;
10. authority routing + handoff continuity;
11. degraded-evidence/self-healing trial harness;
12. local ANE execution-profile adapter and hardware measurement wave;
13. multi-provider comparison: JEV vs Mavis vs Qwen/ANE;
14. separate production-port proposal.

Each wave must use RED -> GREEN evidence and leave production repos untouched.

## 26. Acceptance criteria for the laboratory architecture

The V1 lab design is considered technically established only when:

- every authority mask transition is source-backed and testable;
- no optimization code path can create `M_auth = 1`;
- semantic provider adapters cannot mint recovery or authority identities;
- exact source/candidate ordering survives gather/scatter;
- stale views are mechanically rejected;
- source-invalid or evidence-insufficient lanes do not reach policy authority;
- uncalibrated profile drift continues the task through conservative fallback;
- compatible drift triggers automatic single-flight replay/refit;
- weak labels remain non-authoritative;
- promotion is atomic and rollbackable;
- receipt spine is durable before consequential authority consumption;
- enrichment backpressure cannot erase authority provenance;
- cloud CI remains green on macOS and Linux;
- local ANE claims have exact-SHA machine receipts;
- live provider claims bind exact model identity and usage telemetry;
- a fresh independent reviewer accepts the exact lab head before any production-port recommendation.

## 27. Design decision

V1 adopts:

> **No-stop task plane. Fail-closed authority plane. Self-healing calibration plane.**

and:

> **An optimization may preserve or reduce authority. It may never create more authority.**

The immediate next engineering target after this design is approved as a written spec is the **identity + evidence + mask substrate**, because every later self-healing, batching, receipt, and provider feature depends on those semantics being immutable first.
