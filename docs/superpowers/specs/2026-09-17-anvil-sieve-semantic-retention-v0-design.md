# ANVIL / SIEVE Semantic Retention V0 Design

**Status:** approved cloud-laboratory direction, not production integration  
**Repository:** `naytewilson/fast-jev-compaction`  
**Branch:** `north/anvil-sieve-semantic-retention-v0`

## Source-truth anchors at design start

- Fork main: `e3f262a7f4d42bd8dd32ced30d26176f7cb545b0`
- Upstream main: `e3f262a7f4d42bd8dd32ced30d26176f7cb545b0`
- Upstream PR #18 candidate head: `34ccb121afa08cc5586564a01e481cd473d95c0e`
- `naytewilson/local-agent-gateway` main: `d759c9633a39e397604b3dff5bbf70a589a031d9`
- `naytewilson/anvil` main: `e9201da6d0fe251f267e36f41f6e4c7d6831b541`
- ANVIL JEV Decision Fabric PR #97 head observed during design: `2295f7057f98ecf20a4e4980ffc60500d52c6854`

Re-query every mutable ref before implementation or adjudication. These anchors describe the design input, not future authority.

## 1. Objective

Use this fork as an isolated cloud laboratory to harvest and test semantic-retention mechanisms without introducing fast-jev-compaction directly into ANVIL, local-agent-gateway, SIEVE, ReCompress, Paseo, or production runtime paths.

The experiment must answer one question:

> Can a bounded semantic observer reduce model-visible context materially while preserving all material evidence, keeping recovery exact, and leaving authority in deterministic ANVIL/SIEVE components?

Compression ratio alone is not success.

The primary safety metric is **critical-evidence false eviction**.

## 2. Jurisdiction law

The experiment preserves the current stack's authority boundaries.

| Concern | Authority |
| --- | --- |
| Canonical evidence bytes | ContextLedger / CAS |
| Long-term retention tier and rehydration | ReCompress |
| Candidate presentation construction | ContextPlanning |
| Semantic observations | Decision Fabric execution provider |
| Candidate verification | SIEVE verifier |
| Model-visible presentation permission | PresentationAuthority |
| Semantic contract definition | DecisionContract |
| Provider/model selection | ExecutionProfile |
| Model-specific calibration | CalibrationProfile |
| Deterministic abstention and interpretation | PolicyProfile |

Jev never owns storage, source truth, permission, deletion, ReCompress transitions, or presentation authority.

The fork may simulate these boundaries in replay, but it must not call production SIEVE or ReCompress mutation surfaces.

## 3. Non-goals

V0 will not:

- merge code into ANVIL or local-agent-gateway;
- activate a SIEVE candidate path;
- change ReCompress policy;
- deploy a daemon;
- hold production TypeSafe credentials;
- delete canonical evidence;
- treat `jev-latest` as an acceptable immutable execution identity;
- use a universal `0.5` threshold as calibrated policy;
- allow caller-supplied arbitrary semantic question text;
- treat project-relative files as canonical recovery;
- treat re-running a tool as equivalent to exact recovery.

## 4. Architecture

```text
tool result / conversation evidence
            |
            +-----------------------> canonical CAS / ledger identity
            |
            v
 deterministic candidate extraction
            |
            v
 deterministic hard-root extraction
            |
            v
 bounded + redacted candidate views
            |
            v
 MappedDecisionContract
            |
            v
 ExecutionProfile
    Jev today / Mavis or ANE model later
            |
            v
 strict alignment + validation
            |
            v
 typed semantic observations
            |
            v
 deterministic PolicyProfile
            |
            v
 simulated ContextPlan disposition
            |
            v
 replay metrics only
```

Any semantic-provider failure returns the replay item to the pristine arm. V0 does not mutate historical state.

## 5. MappedDecisionContract

### 5.1 Why mapped contracts exist

Decision Fabric V1 binds one frozen question set to one state. Semantic retention needs one frozen semantic program applied to N bounded candidates while retaining shared-state economics.

The solution is a mapped contract, not arbitrary dynamic question injection.

One immutable semantic definition is instantiated over a bounded candidate set.

### 5.2 Provider-neutral contract identity

V0 defines these four independent identities:

```text
DecisionContract
  semantic intent + state schema + candidate schema + observation schema

ExecutionProfile
  provider adapter + exact model identity + transport behavior

CalibrationProfile
  contract digest + execution profile digest + normalizer digest +
  corpus identity + threshold/temperature/calibration artifacts

PolicyProfile
  deterministic abstention + retention interpretation rules
```

Changing any one produces a new digest. Replay receipts bind all four.

### 5.3 Canonical mapped request

The provider-neutral laboratory request is:

```json
{
  "schema": "anvil.mapped-decision-request.v0",
  "request_id": "mdr-...",
  "source_run_id": "run-...",
  "decision_contract": {
    "id": "anvil.context-retention.v1",
    "version": "0.1.0",
    "digest": "sha256:..."
  },
  "execution_profile": {
    "id": "typesafe-systemone-jev",
    "version": "0.1.0",
    "digest": "sha256:..."
  },
  "calibration_profile": {
    "id": "anvil.context-retention.jev-1.13.0.shadow",
    "version": "0.1.0",
    "digest": "sha256:..."
  },
  "policy_profile": {
    "id": "anvil.context-retention.shadow-policy",
    "version": "0.1.0",
    "digest": "sha256:..."
  },
  "shared_conversation_state": {
    "mission": "...",
    "recent_turns": [],
    "active_constraints": [],
    "unresolved_failures": [],
    "source_refs": []
  },
  "candidate_views": [
    {
      "candidate_id": "cand-0001",
      "source_digest": "sha256:...",
      "source_kind": "tool_result",
      "recovery_ref": "cas:...",
      "byte_count": 12345,
      "hard_roots": {
        "exit_status": 1,
        "stderr": [],
        "first_lines": [],
        "last_lines": []
      },
      "semantic_view": {
        "head": "...",
        "tail": "...",
        "selected_chunks": [],
        "omitted_bytes": 9000
      }
    }
  ]
}
```

### 5.4 Request invariants

Before provider egress, the laboratory validator must enforce:

- `candidate_views.length` is 1...64;
- candidate IDs are unique and match a strict identifier grammar;
- source digest is a canonical SHA-256 identity;
- recovery ref is present for any candidate that could be simulated as referential;
- every candidate is within an exact serialized byte budget;
- shared state is within an exact serialized byte budget;
- no unregistered top-level or candidate fields;
- no secrets or forbidden fields after the redaction pass;
- candidate order is deterministic;
- hard roots are derived before semantic processing;
- provider execution cannot alter candidate IDs or request ordering.

A request that fails any invariant never reaches the semantic provider.

## 6. Frozen semantic observations

The contract defines the same five observations for every candidate:

```text
evidence_sufficient
still_needed
full_content_needed
unresolved_evidence
recoverable
```

Meanings:

- **evidence_sufficient**: the bounded candidate view plus shared state is sufficient to judge retention.
- **still_needed**: the candidate carries information likely needed for the ongoing mission.
- **full_content_needed**: retaining only a bounded/referential presentation would materially reduce usefulness.
- **unresolved_evidence**: the candidate contains unresolved failure, warning, contradiction, dependency, or verification evidence.
- **recoverable**: the omitted bytes are recoverable through the declared exact recovery identity.

`recoverable` is semantically observed in the lab only for comparison. Production promotion must still establish recovery mechanically. A semantic "yes" can never substitute for a verified CAS binding.

## 7. Jev execution mapping

System One / Jev is an execution backend, not the contract owner.

If the current API does not natively return a custom array object, the adapter may encode the frozen mapped questions under deterministic IDs such as:

```text
cand-0001.evidence_sufficient
cand-0001.still_needed
cand-0001.full_content_needed
cand-0001.unresolved_evidence
cand-0001.recoverable
```

and then reassemble them into the provider-neutral tuple array.

No request may provide free-form question instructions.

The adapter must preserve one shared state payload where the provider API permits it, so candidate fan-out amortizes shared context rather than repeating independent conversation payloads.

## 8. Strict mapped response

The provider-neutral laboratory response is:

```json
{
  "schema": "anvil.mapped-decision-response.v0",
  "request_id": "mdr-...",
  "observations": [
    {
      "candidate_id": "cand-0001",
      "evidence_sufficient": { "noul": 0.97 },
      "still_needed": { "noul": 0.81 },
      "full_content_needed": { "noul": 0.32 },
      "unresolved_evidence": { "noul": 0.91 },
      "recoverable": { "noul": 0.99 }
    }
  ]
}
```

### 8.1 Alignment gate

The entire mapped batch becomes **PRISTINE_FALLBACK** if any of these occur:

- response candidate ID is missing;
- response candidate ID is unknown;
- duplicate candidate ID appears;
- expected candidate is absent;
- observation field is absent;
- unknown observation field appears;
- `noul` is non-finite;
- `noul < 0` or `noul > 1`;
- request ID differs;
- response shape is malformed;
- provider result cannot be mapped one-to-one to the original ordered candidate set.

Partial semantic success never partially mutates the replay state.

Historical state is untouched regardless of provider outcome.

## 9. Deterministic hard roots

Semantic evaluation happens only after hard-root extraction.

V0 hard roots are:

1. exit status / return code;
2. stderr lines;
3. first N stdout lines;
4. last N stdout lines.

For V0, stderr is preserved mechanically rather than semantically scored.

If hard roots alone exceed the configured presentation budget, the candidate is ineligible for semantic trimming and the replay returns pristine. V0 does not silently truncate hard roots to force a semantic decision.

A later version may add mechanically recognized stack-trace ranges, but those recognizers require their own replay evidence before becoming hard-root policy.

## 10. CAS binding and referential presentation

Upstream PR #18 stores full Bash output under a mutable project path. V0 replaces that assumption with a content-addressed recovery identity.

A simulated referential marker has the form:

```text
[sieve-evidence source=sha256:<digest> recovery=cas:<object-id> omitted_bytes=<count>]
```

The marker is valid only when the replay fixture contains an exact recovery object whose digest reproduces the source bytes.

No "re-run the command if needed" marker qualifies as reversible recovery.

No semantic provider can mint a recovery identity.

## 11. Simulated retention actions

The observation-only policy may simulate:

```text
KEEP_FULL
KEEP_HEAD_TAIL
KEEP_REFERENCE
EVICT_FROM_PRESENTATION
ABSTAIN
```

These are replay dispositions only.

V0 must never delete canonical bytes or call production presentation authority.

`ABSTAIN` is mandatory when evidence sufficiency is below the active calibration floor or when any mechanical recovery requirement is not established.

## 12. Deterministic policy order

V0 policy evaluation is ordered:

1. provider/alignment failure -> PRISTINE_FALLBACK;
2. evidence insufficiency -> ABSTAIN / pristine;
3. unresolved evidence high -> KEEP_FULL;
4. recovery mechanically unavailable -> KEEP_FULL;
5. full content needed high -> KEEP_FULL;
6. still needed high -> KEEP_HEAD_TAIL or KEEP_REFERENCE according to deterministic candidate shape;
7. otherwise -> EVICT_FROM_PRESENTATION in replay only.

Threshold values are calibration-profile data, not universal contract constants.

No default threshold is represented as "safe" or "calibrated" until replay evidence exists.

## 13. Upstream PR #18 mechanism harvest

PR #18 is **unmerged candidate evidence**.

V0 may harvest these mechanisms:

- pre-context filtering;
- deterministic chunking;
- first/last hard retention;
- keeping unscored chunks rather than dropping them;
- provider failure returning original output;
- preserving exact full output outside the reduced presentation;
- structured/binary bypass;
- bounded chunk count.

V0 must not inherit as authority:

- project-relative archive paths;
- regex secret detection as a security boundary;
- `jev-latest`;
- universal `0.5` policy;
- "rerun the command" as exact recovery;
- provider-selected deletion;
- direct production TypeSafe credential ownership.

## 14. Replay matrix

All experiments use identical source-bound traces.

### Arm A: PRISTINE

No trimming. Canonical source is presented in full.

### Arm B: DETERMINISTIC_ONLY

Hard roots plus deterministic head/tail policy. No semantic provider.

### Arm C: UPSTREAM_FAST_JEV

Current upstream semantic behavior reproduced as faithfully as practical, including its current information limitations. This arm is experimental evidence, not an endorsed policy.

### Arm D: SIEVE_OBSERVATION_ONLY

MappedDecisionContract + deterministic hard roots + CAS-bound recovery + strict alignment + deterministic policy simulation.

No production SIEVE mutation occurs.

## 15. Replay corpus

The corpus must contain both realistic and adversarial/synthetic traces.

Synthetic dependency traps are required.

Examples:

- a build emits one deprecation warning in the middle of thousands of success lines; ten turns later the task depends on the deprecated API name;
- a memory address appears once in a long sanitizer trace and is needed later;
- a warning is emitted on stderr while stdout is mostly progress noise;
- the first command fails, a later command succeeds, and the agent must preserve the original failure cause;
- an apparently repetitive list contains one changed source path required by a later patch;
- a candidate is semantically redundant but carries the only provenance ref;
- a candidate's semantic view is insufficient to judge the omitted middle;
- recovery metadata is missing or digest-mismatched.

Every trap fixture identifies the exact critical evidence span and its downstream dependency.

## 16. Metrics

### 16.1 Primary: critical-evidence false eviction

A false eviction occurs when a replay arm removes material evidence from the model-visible presentation and that omission either:

1. causes a downstream task failure;
2. causes an incorrect downstream answer/action;
3. forces a reread/rehydration that the pristine arm did not require because the needed evidence had been removed.

This metric is reported both as count and rate over labeled critical-evidence opportunities.

### 16.2 Reread and rehydration

Record:

- recovery attempts;
- successful exact rehydrations;
- unnecessary rereads caused by trimming;
- tool re-executions caused by missing context;
- rehydration latency;
- reintroduced provider-visible tokens.

### 16.3 Token economics

Record exact or provider-reported token counts where available.

```text
gross_context_tokens_saved
  = pristine_downstream_tokens - arm_downstream_tokens_before_rehydration

semantic_cost_tokens
  = semantic_provider_input_tokens + semantic_provider_output_tokens

recovery_cost_tokens
  = rehydrated_tokens + reread_result_tokens

net_token_savings
  = gross_context_tokens_saved
    - semantic_cost_tokens
    - recovery_cost_tokens

jev_efficiency_ratio
  = gross_context_tokens_saved
    / max(1, semantic_cost_tokens + recovery_cost_tokens)
```

A ratio below 1 means the semantic machinery consumed more token budget than it saved.

Report latency and monetary cost separately. Token efficiency is not a substitute for dollar or wall-clock accounting.

### 16.4 Additional metrics

- task completion parity vs pristine;
- critical constraint recall;
- unresolved-error preservation;
- semantic abstention rate;
- provider malformed/alignment failure rate;
- candidate count;
- bytes/tokens before and after;
- semantic calls per replay;
- semantic provider input/output tokens;
- end-to-end replay latency;
- monetary semantic-provider cost;
- deterministic hard-root bytes;
- fraction of candidates ineligible because hard roots exceed budget;
- recovery success rate;
- false confident eviction attempts prevented by sufficiency gate.

## 17. Receipt requirements

Every Arm D replay emits a laboratory receipt binding at minimum:

```text
receipt_schema
receipt_id
source_trace_digest
source_run_id
decision_contract_id/version/digest
execution_profile_id/version/digest
calibration_profile_id/version/digest
policy_profile_id/version/digest
shared_state_digest
candidate_set_digest
ordered_candidate_ids
provider_request_digest
provider_response_digest
observation_set_digest
hard_root_policy_digest
recovery_manifest_digest
policy_dispositions
provider_model_requested
provider_model_effective
provider_usage
latency
error_code
pristine_fallback
receipt_digest
```

The receipt stores no provider credential and no unsanitized secret material.

## 18. Security and privacy

Redaction occurs before semantic-provider egress.

The semantic provider is not a secret detector.

A candidate that cannot be safely redacted while preserving enough information to judge retention is ineligible for remote semantic evaluation and remains pristine.

Tool output is untrusted data. It must never be concatenated into semantic instructions or policy text.

Candidate content occupies data fields only.

## 19. Cloud CI

The laboratory branch will add a GitHub Actions matrix using the repo's existing Node >=18 contract.

Initial matrix:

```text
ubuntu-latest / Node 20
ubuntu-latest / Node 22
macos-latest  / Node 20
macos-latest  / Node 22
```

Required commands:

```text
npm ci
npm run typecheck
npm test
npm run build
```

No TypeSafe secret is required for deterministic unit/replay-schema tests.

Live semantic-provider experiments must be opt-in and separate from required CI.

## 20. Implementation order

1. Add cloud CI without semantic-provider credentials.
2. Add provider-neutral mapped-contract types and strict validator tests.
3. Add alignment/reassembly tests for missing, duplicate, unknown, out-of-range, and malformed results.
4. Add deterministic hard-root extraction and tests.
5. Add content-addressed recovery manifest fixtures and exact digest verification.
6. Add replay-arm interfaces and Arm A/B baselines.
7. Add Arm C upstream-behavior adapter for comparison.
8. Add Arm D observation-only adapter and deterministic policy simulation.
9. Add synthetic dependency-trap fixtures.
10. Add metrics aggregation and receipt emission.
11. Run cloud deterministic matrix.
12. Only after deterministic CI is green, run a bounded live Jev replay using an exact pinned model identity and separate experimental credential path.
13. Request fresh independent review of the exact branch head before recommending any production port.

## 21. Promotion gates

No mechanism moves from this laboratory into ANVIL/SIEVE unless all are true:

- source-bound replay corpus exists;
- critical-evidence false eviction is measured;
- recovery is mechanically exact;
- mapped-response alignment is fail-closed;
- malformed/provider failure is pristine-safe;
- contract/execution/calibration/policy identities are independently bound;
- no arbitrary semantic question passthrough exists;
- provider/model identity is pinned;
- deterministic CI is green on macOS and Linux;
- a fresh independent reviewer accepts the exact candidate head;
- production integration is proposed as a separate design/change.

## 22. Kill conditions

Stop and return to pristine-only experimentation if:

- semantic provider cannot produce strictly alignable candidate observations;
- redaction removes information needed to determine sufficiency;
- critical-evidence false eviction exceeds deterministic-only baseline without a clear fix;
- semantic token cost routinely exceeds gross savings;
- exact recovery cannot be proved;
- the design would require widening SIEVE or ReCompress authority to accommodate Jev;
- implementation pressure begins modifying active production repos from this branch.

## 23. Design decision

The next implementation focus is **MappedDecisionContract schema and fail-closed alignment first**, not the metrics pipeline first.

Reason: the replay harness must measure a stable semantic unit. If candidate identity, observation alignment, profile binding, sufficiency, and fallback semantics are still moving, metrics produced by the harness are not comparable or provenance-stable.

The metrics pipeline starts immediately after the mapped contract and hard-root/recovery identities are testable, using those schemas as its fixed input.
