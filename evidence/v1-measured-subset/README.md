# V1 measured-local-inference subset — frozen evidence

7 of 26 canonical candidates scored by real LFM2.5-2.6B (ANE-compiled
KVIO) on Neo, 2026-09-18, before the V1->V2 ABI conversion. This is
HISTORICAL_MEASURED_EVIDENCE with promotionAuthority=NONE.

- `provenance-receipt.json` — the binding receipt (read this first)
- `SHA256SUMS.raw` — sha256 + byte size of every raw payload
- `raw/` — immutable copies of score logs, parsed noul, plan output,
  tokenizer, manifests, driver, wall-time samples

V1 probabilities are NOT valid as V2 observations (ABI v2 redefines
evidence_sufficient and unresolved_evidence, removes recoverable).
Do not project, rename, truncate, or reinterpret these values as V2.
