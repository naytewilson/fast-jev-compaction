# Semantic Observation ABI V1 Calibration Battery

**Status:** LAB-ONLY EXPERIMENT CONTRACT  
**Date:** 2026-09-18  
**Repository:** `naytewilson/fast-jev-compaction`  
**Owned experiment branch:** `north/semantic-abi-v1-experiment-20260918`

## Mission

Adjudicate the next Semantic Observation ABI from measured evidence without changing production ANVIL, SIEVE, ReCompress, Paseo, local-agent-gateway, or protected branches.

The current canonical laboratory ABI remains replayable as the five-axis v0 contract until this battery proves a successor contract and its migration consequences.

## Current source-backed observation

The current laboratory implementation models five semantic axes:

- `evidence_sufficient`
- `still_needed`
- `full_content_needed`
- `unresolved_evidence`
- `recoverable`

The current observation policy already performs exact recovery verification mechanically through CAS before using semantic retention observations. Modeled `recoverable` does not authorize mechanical recovery.

The existing calibration compiler, calibration artifacts, provider profiles, semantic program digest, replay predictions, and receipt lineage are all currently built around the five-axis set. Therefore a four-axis ABI is a versioned migration, not a silent prompt edit.

## Candidate ABI split

### Observation ABI v0 — historical/replayable semantic vector

```text
evidence_sufficient
still_needed
full_content_needed
unresolved_evidence
recoverable
```

### Observation ABI v1 candidate — semantic plane

```text
evidence_sufficient
still_needed
full_content_needed
unresolved_evidence
```

### Mechanical recovery plane

```text
recovery_verified
  recovery_ref
  source_digest
  store/generation identity when applicable
```

Recovery authority is supplied by exact evidence-system verification. Semantic providers do not grant recovery authority.

## Migration law

Do not mutate `MAPPED_OBSERVATION_AXES`, the canonical semantic program, calibration artifact schema, provider profile identity, or policy thresholds merely because the exploratory battery suggests v1.

First measure v0 versus v1. If v1 is adopted, mint a new ABI version/digest and preserve v0 replay.

## Evidence classification

The prior exploratory JEV battery is **WEAK / author-labeled exploratory evidence**.

It may guide experiment design. It may not:

- establish calibration authority;
- establish production thresholds;
- mint production policy authority;
- justify production presentation/retention changes;
- silently redefine predicate semantics.

The committed `artifacts/neo-campaign/*` corpus currently identifies itself as `synthetic-fixture`. Its perfect holdout calibration metrics are not evidence that the live JEV semantic battery is calibrated.

## Wave A — four-axis versus five-axis A/B

Run the exact same frozen scenarios with the same pinned provider/model and the same candidate evidence.

Compare:

**v0 modeled axes**
- evidence_sufficient
- still_needed
- full_content_needed
- unresolved_evidence
- recoverable

**candidate v1 modeled axes**
- evidence_sufficient
- still_needed
- full_content_needed
- unresolved_evidence

For v1, recovery truth comes only from deterministic recovery-store/CAS verification.

Measure:

- provider input tokens;
- provider output tokens;
- wall latency;
- per-call latency;
- malformed/failed responses;
- question count;
- prediction changes on the four shared predicates.

Do not assume latency scales linearly with question count.

Primary question: does removing modeled `recoverable` materially change the other four outputs or improve cost/latency/failure surface?

## Wave B — threshold-free metrics

For every modeled predicate compute:

- AUROC;
- AUPRC;
- Brier score;
- ECE;
- NLL;
- positive mean probability;
- negative mean probability;
- positive count;
- negative count.

Do not describe `recoverable` as worse than chance solely from accuracy at 0.5. Determine whether it retains ranking information.

## Wave C — evidence-sufficiency calibration

Build a larger balanced source-bound corpus.

Split before calibration:

```text
TRAIN
HOLDOUT
```

Rules:

- choose no threshold from HOLDOUT;
- use STRONG labels for authoritative calibration claims;
- WEAK author labels remain exploratory;
- fit the existing provider-specific isotonic calibration model on TRAIN;
- evaluate raw and calibrated probabilities on HOLDOUT.

Report:

- ECE;
- Brier;
- NLL;
- AUROC;
- AUPRC;
- selective risk;
- coverage;
- false-authority opportunities and leaks where policy simulation is meaningful.

The objective is to determine whether provider-specific calibration makes `evidence_sufficient` a stable epistemic gate. A raw threshold such as 0.25 remains a hypothesis, not an architecture constant.

## Wave D — unresolved-evidence disentanglement

Construct a controlled 2x2 corpus:

| Completeness | Contradiction | Purpose |
| --- | --- | --- |
| complete | no | clean resolved control |
| complete | yes | contradiction discriminator |
| incomplete | no | incompleteness without contradiction |
| incomplete | yes | both factors present |

Also include:

- unresolved warning;
- unresolved dependency;
- unresolved verification state;
- fully resolved historical failure.

Adjudicate what the current broad predicate actually detects.

Possible outcomes:

1. keep `unresolved_evidence` broad;
2. rename it `review_needed` in a future version;
3. add a distinct contradiction predicate in a later ABI.

Do not change the ABI merely to make the current labels easier to score.

## Wave E — still-needed hard negatives

Substantially increase negatives:

- obsolete but valid logs;
- completed-task evidence;
- superseded configuration;
- duplicate evidence;
- unrelated but technically plausible evidence;
- stale evidence from the wrong generation;
- evidence for a previous mission.

Re-evaluate whether the exploratory `still_needed` result survives a balanced negative set.

## Wave F — repeatability and invariance

For each scenario:

- repeat at least 8 times;
- shuffle question order;
- shuffle candidate order;
- change batch composition;
- repeat later in the campaign against the same pinned model.

Report:

- mean;
- standard deviation;
- max deviation;
- question-order sensitivity;
- candidate-order sensitivity;
- batch sensitivity;
- temporal replay delta.

Call this repeatability unless stronger evidence supports deterministic behavior.

## Wave G — provider comparison

If Qwen/ANE and/or Mavis are actually available, run the identical frozen corpus and predicate definitions through them.

Keep distinct `ProviderExecutionProfile` identities.

Never transfer a JEV calibration map to Qwen or Mavis.

Compare:

- AUROC/AUPRC;
- ECE/Brier/NLL;
- evidence-sufficiency selective risk;
- latency;
- token/economic cost where observable;
- repeatability;
- failure rate.

If a provider is unavailable, record that fact and continue.

## Required artifacts

Preserve:

- exact frozen corpus;
- label file with authority class;
- raw provider requests/responses or safe source-bound equivalents;
- machine-readable predictions;
- provider/model identity;
- experiment configuration;
- source Git SHA;
- timing/token metadata;
- full raw and calibrated metrics;
- ordering/batch permutations;
- plots/tables when useful;
- concise architecture adjudication.

Every conclusion must be classified:

- PROVEN
- OBSERVED
- INFERRED
- UNKNOWN

## Acceptance gates for proposing ABI v1

A proposal to make four-axis ABI v1 canonical requires, at minimum:

1. v0/v1 A/B shows no unacceptable degradation on the four retained predicates;
2. recovery authority remains mechanically verified and independent of semantic output;
3. provider/calibration identities bind the new ABI version/digest;
4. v0 receipts remain replayable;
5. calibration code no longer assumes the historical five-axis set without an explicit versioned compatibility path;
6. policy consumes calibrated observations where a calibrated artifact is required;
7. held-out evidence supports the evidence-sufficiency gate;
8. no production authority is granted by this experiment.

## What does not count as completion

- changing `evidenceSufficientFloor` to 0.25;
- deleting `recoverable` from the prompt while leaving historical identity/digests ambiguous;
- using WEAK author labels as STRONG calibration authority;
- reporting only accuracy at 0.5;
- calling within-battery repeatability deterministic behavior;
- using synthetic-fixture calibration metrics as evidence for live-provider calibration;
- changing production SIEVE/ReCompress policy.

## Intended next implementation slice

Build experiment-only support for:

1. v0/v1 axis-set A/B calls without mutating the canonical five-axis contract;
2. threshold-free AUROC/AUPRC metrics;
3. raw-versus-calibrated metric reporting;
4. frozen permutation/repeatability manifests.

Then run the live provider battery on the worker with the required provider credentials and local runtime access.

Production port remains unauthorized.
