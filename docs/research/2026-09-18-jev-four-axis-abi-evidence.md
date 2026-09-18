# JEV 2026-09-18 weak-label experiment: four-axis ABI adjudication

## Evidence status

The motivating experiment is **OBSERVED / WEAK-LABEL evidence**, not an
authoritative calibration artifact.

Reported setup:

- model: `jev-1.13.0`
- 100 calls
- 392 judgments
- 24 calibration scenarios
- author labels supplied by Milo
- labels explicitly described as not STRONG
- repeatability mean standard deviation around 0.01
- `recoverable` reported at 0.458 accuracy, 0.510 ECE, 0.440 Brier
- `still_needed` reported at 0.917 accuracy
- evidence-sufficiency degradation gradient reported as
  FULL 0.60 -> PARTIAL 0.04 -> HEAD_TAIL 0.08 -> CONTRADICTORY 0.20 ->
  IRRELEVANT 0.08 -> ABSENT 0.02

These values are retained as experimental observations. They are not promoted
to calibration authority because the corpus is small and author-labeled.

## Architectural adjudication

The experiment is strong enough to change **jurisdiction**, but not strong
enough to set production thresholds.

### 1. Remove modeled recoverability from the successor semantic ABI

The successor observation ABI models four axes:

1. `evidence_sufficient`
2. `still_needed`
3. `full_content_needed`
4. `unresolved_evidence`

Recoverability moves entirely to a mechanical attestation derived from the
recovery/CAS plane.

A provider cannot increase recovery authority by assigning a high probability.

### 2. Do not hard-code the reported ~0.25 sufficiency threshold

The observed JEV scores suggest systematic under-confidence on this weak corpus,
but a global threshold would transfer weak-label evidence into authority.

The successor policy therefore keeps `evidenceSufficientFloor` inside the
versioned calibration/policy profile. Provider-specific STRONG-label
calibration must determine authoritative thresholds.

### 3. Treat unresolved evidence as conservative review advice

The experiment suggests that JEV often maps incomplete/missing evidence into
`unresolved_evidence`. The successor semantics therefore do not interpret a
high score as proof of contradiction. It is a conservative review signal.

### 4. Keep the current v0/five-axis path intact during migration

The current v0 lab remains reproducible for comparison and for the running Neo
overnight campaign. The four-axis design is introduced as a new versioned ABI,
not a silent mutation of historical receipts or calibration identities.

## Migration target

```text
source-bound evidence
       |
       +--> deterministic recovery/CAS check --> M_recovery
       |
       +--> four-axis semantic sensor
                    |
                    +--> evidence sufficiency gate
                    +--> still-needed
                    +--> full-content advisory
                    +--> unresolved/review advisory
                              |
                              v
                    deterministic retention policy
```

The invariant remains:

> Semantic acceleration may preserve or reduce authority. It cannot create
> source, evidence, recovery, calibration, or execution authority.


### 5. Mechanical recovery authority is issuer-bound

A structural object claiming `status: VERIFIED` is not recovery authority.

The v2 path uses a `MechanicalRecoveryAttestor` that derives status only from
the CAS verifier and binds the attestation to the exact CAS snapshot digest.
The deterministic retention policy rejects structural copies and stale
attestations before allowing referential presentation or eviction.

This closes a subtle authority hole in which a caller could otherwise fabricate
a recovery-shaped object even after the modeled `recoverable` predicate had
been removed.
