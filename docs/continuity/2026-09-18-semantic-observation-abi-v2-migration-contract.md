# Semantic Observation ABI v2 Migration Contract

Status: LAB-ONLY CONVERSION COMPATIBILITY

## Current authority split

The active semantic vector is four-axis and uses:

- anvil.mapped-decision-request.v1
- anvil.mapped-decision-response.v1
- anvil.semantic-observation-abi.v2
- anvil.registered-semantic-program.v2
- anvil.context-retention.v2

The semantic axes are:

- evidence_sufficient
- still_needed
- full_content_needed
- unresolved_evidence

Recovery is not a semantic axis. Recovery authority remains mechanical and source-bound through CAS/store verification.

## Historical replay law

The previous five-axis laboratory contract remains a distinct historical namespace:

- anvil.mapped-decision-request.v0
- anvil.mapped-decision-response.v0
- anvil.semantic-observation-abi.v1
- anvil.registered-semantic-program.v1
- anvil.context-retention.v1

Its fifth modeled predicate, recoverable, is historical semantic evidence only.

The compatibility module src/lab/legacy-v1.ts exists so historical requests, responses, observation envelopes, and compiled-program identity can still be validated and replayed as v1.

It does not translate modeled recoverable into mechanical recovery authority.

It does not mint v2 observations, v2 calibration, provider authority, production authority, or presentation authority.

## No silent conversion

There is intentionally no v1-to-v2 observation converter.

The v2 unresolved_evidence definition is broader than the v1 definition, and v2 removes modeled recoverable entirely. Re-labeling old probability vectors as v2 would therefore falsify provenance and semantic-program identity.

Historical v1 provider profiles and calibration lineage remain bound to their original program/ABI/profile digests. A v2 provider profile or calibration artifact must be built and calibrated independently under the v2 identities.

## Acceptance properties

1. Current v2 validators reject v1 wire objects.
2. Legacy validators accept only exact v1/v0 shapes.
3. Legacy replay preserves the old recoverable probability as historical evidence.
4. The exact historical semantic-program digest is reproducible from the frozen v1 compiler.
5. No compatibility path creates mechanical recovery authority.
6. Unknown ABI versions fail closed.
7. Production ANVIL, SIEVE, ReCompress, Local Agent Gateway, Paseo, and protected refs remain outside this lab wave.
