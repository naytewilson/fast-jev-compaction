# Jev Predicate Random Battery — 2026-09-18

Status: **OBSERVED RESEARCH EVIDENCE / NON-AUTHORITATIVE LABELS**

Run supplied by the local experiment worker:

- run: `runs/20260918T044727Z/`
- 100 calls
- 392 judgments
- model: `jev-1.13.0`
- labels: author-labeled by Milo, **not STRONG**
- raw calls: `raw/`
- judgments: `results.jsonl`

## E1 — five-predicate calibration sample

| predicate | acc@0.5 | ECE | Brier | mean p label=1 | mean p label=0 |
| --- | ---: | ---: | ---: | ---: | ---: |
| evidence_sufficient | 0.667 | 0.225 | 0.207 | 0.44 (n=12) | 0.11 (n=12) |
| still_needed | 0.917 | 0.244 | 0.092 | 0.72 (n=20) | 0.07 (n=4) |
| full_content_needed | 0.750 | 0.192 | 0.200 | 0.56 (n=13) | 0.31 (n=11) |
| unresolved_evidence | 0.750 | 0.238 | 0.140 | 0.76 (n=4) | 0.32 (n=20) |
| recoverable | 0.458 | 0.510 | 0.440 | 0.22 (n=16) | 0.03 (n=8) |

## E2 — degradation gradient

Mean `p(evidence_sufficient)`:

```text
FULL          0.60
PARTIAL       0.04
HEAD_TAIL     0.08
CONTRADICTORY 0.20
IRRELEVANT    0.08
ABSENT        0.02
```

Six scenarios per condition.

`still_needed` on IRRELEVANT was 0.27 versus 0.60 on other degradations.

## E3 — repeatability

Mean standard deviation over eight repetitions per scenario/predicate:

```text
evidence_sufficient  0.015
still_needed         0.012
full_content_needed  0.010
unresolved_evidence  0.012
recoverable          0.011
max observed         0.032
```

## Source-reported interpretation

1. `evidence_sufficient` separated degraded from FULL states strongly but appeared conservative as an absolute probability.
2. `recoverable` performed poorly as a modeled judgment and should remain mechanical.
3. `unresolved_evidence` appeared to conflate incomplete evidence with contradictory/unresolved evidence.
4. `still_needed` was the strongest predicate in this small battery.
5. `full_content_needed` looked useful as a soft/advisory signal.
6. Repeatability was high.

## Controller adjudication

This run is useful enough to change **architecture**, but not enough to grant or retune **authority**.

### Accepted architecture correction

The next semantic ABI removes `recoverable` from the modeled predicate set. Recovery authority comes only from deterministic CAS/store verification.

### Accepted gate-order correction

The next policy order is:

```text
evidence_sufficient
  -> still_needed
  -> full_content_needed
  -> unresolved_evidence review advisory
  -> mechanical recovery where a reversible reference/eviction requires it
```

If evidence is insufficient, the later modeled predicates have zero policy authority for that lane.

### Explicitly NOT accepted from this run

- No production threshold is changed to 0.2–0.3.
- No CalibrationIdentity may be fitted from these author labels.
- No PromotedCalibrationArtifact or authority credential may descend from this battery.
- No provider ranking is established.
- No production deployment gate is opened.

The threshold hint must be re-tested on source-bound STRONG labels and a held-out corpus before it can enter an authoritative calibration profile.
