# causal-stepper (vendored reference copy)

Canonical source: `/Users/nayte/ane-hot/workspace/lfm-family-neo-validation/tools/causal-stepper`
on Neo (macOS 27.2 / A18 Pro). Vendored at the exact state used for the
Semantic Fabric V1 campaign measurements so the hardware receipt's
commitSha binds the measurement code.

Campaign-relevant modes added for this campaign:

- `score` — batch semantic probe: reads anvil.noul-ids.v2 manifest rows
  (`--fixture`), runs prefill over S16 windows only (prompt lengths are
  exact multiples of 16 — no KV pads, no decode), emits one PROBE_JSON
  per probe offset ({offset,probs,abs}) plus SCORE_BEGIN/SCORE_END
  records with wall ms and RSS.
- `probe` — single-prompt probe with `--probe-ids` softmax dump
  (conditional subset + absolute full-vocabulary probabilities).
- `plan` — MLComputePlan inspection: per-op preferred compute device
  counts per package (no inference).

Build on macOS: `swift build`. Requires Xcode 26+/CoreML; the LFM2.5
KVIO packages and embed weights live under
`/Users/nayte/ane-hot/models/lfm25-2p6b-d1p1/` (digests pinned in
artifacts/neo-campaign/neo-inventory.json).
