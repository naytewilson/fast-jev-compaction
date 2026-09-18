// smoke.ts — single live System One call through the synthetic-fixture
// egress boundary. Proves the authorized route before the battery runs.
//
//   TYPESAFE_API_KEY_FILE=~/.local/share/anvil-jev-decisiond/typesafe-api-key \
//     tsx tools/abi-battery/smoke.ts
//
// No key material is printed. One fixture request, five axes, one call.

import { readFileSync } from 'node:fs';
import { runObservationOnlyArm } from '../../src/lab/observation-arm.js';
import { authorizeSyntheticFixtureEgress, SYSTEM_ONE_MAPPED_ENDPOINT } from '../../src/lab/system-one-adapter.js';
import {
  buildSystemOneAxisExperimentPayload,
  parseSystemOneAxisExperimentResponse,
  FIVE_AXIS_EXPERIMENT_AXES,
} from '../../src/lab/semantic-abi-experiment.js';
import { createToolRecoveryManifest, InMemoryCAS, encodeToolEvidence } from '../../src/lab/recovery.js';
import { MAPPED_DECISION_RESPONSE_SCHEMA, type MappedDecisionRequest } from '../../src/lab/types.js';
import type { ReplayTrace } from '../../src/lab/replay.js';
import type { ObservationProfiles } from '../../src/lab/observation-arm.js';
import { sha256Digest } from '../../src/lab/recovery.js';

const MODEL = 'jev-1.13.0';
const keyFile = process.env.TYPESAFE_API_KEY_FILE
  ?? `${process.env.HOME}/.local/share/anvil-jev-decisiond/typesafe-api-key`;
const apiKey = readFileSync(keyFile, 'utf8').trim();
if (apiKey.length < 8) throw new Error('api key file unreadable');

const stdout = Array.from({ length: 64 }, (_, i) =>
  `job-smoke step=${String(i).padStart(4, '0')} status=ok artifact=unit-${i % 7}`).join('\n');
const recovery = createToolRecoveryManifest(stdout, '', 0, 'smoke-object');

const trace: ReplayTrace = {
  trace_id: 'smoke-01',
  source_run_id: 'fixture-abi-battery-smoke-20260918',
  shared_state: 'Continue the engineering task while preserving source-bound evidence.',
  candidates: [{
    candidate_id: 'cand-smoke-0001',
    stdout,
    stderr: '',
    exit_status: 0,
    head_lines: 8,
    tail_lines: 8,
    presentation_budget_bytes: 2048,
    recovery,
    critical_evidence: [],
  }],
};

const profiles: ObservationProfiles = {
  decision_contract: { id: 'anvil.context-retention.v1', version: '1.0.0', digest: sha256Digest('smoke-decision-contract') },
  execution_profile: { id: 'typesafe-system-one/jev-1.13.0', version: '1.0.0', digest: sha256Digest('smoke-exec-profile') },
  calibration_profile: { id: 'smoke-cal', version: '1.0.0', digest: sha256Digest('smoke-cal') },
  policy_profile: { id: 'smoke-pol', version: '1.0.0', digest: sha256Digest('smoke-pol') },
};

const cas = new InMemoryCAS();
cas.put(recovery.recovery_ref.slice(4), encodeToolEvidence(stdout, '', 0));

let captured: MappedDecisionRequest | undefined;
await runObservationOnlyArm(trace, cas, profiles,
  { evidenceSufficientFloor: 0, keepFull: 2, retain: 2 },
  (request) => {
    captured = request;
    return {
      schema: MAPPED_DECISION_RESPONSE_SCHEMA,
      request_id: request.request_id,
      observations: request.candidate_views.map((c) => ({
        candidate_id: c.candidate_id,
        evidence_sufficient: { noul: 0.5 }, still_needed: { noul: 0.5 },
        full_content_needed: { noul: 0.5 }, unresolved_evidence: { noul: 0.5 },
        recoverable: { noul: 0.5 },
      })),
    };
  });
if (!captured) throw new Error('request capture failed');
const request = captured;

const grant = authorizeSyntheticFixtureEgress(request);
console.log(`egress grant scope=${grant.scope} request_digest=${grant.request_digest}`);

const payload = buildSystemOneAxisExperimentPayload(request, MODEL, FIVE_AXIS_EXPERIMENT_AXES);
const body = JSON.stringify(payload);
console.log(`payload model=${payload.model} questions=${Object.keys(payload.questions).length} bytes=${body.length}`);

const t0 = Date.now();
const response = await fetch(SYSTEM_ONE_MAPPED_ENDPOINT, {
  method: 'POST',
  headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
  body,
});
const latencyMs = Date.now() - t0;
const text = await response.text();
console.log(`http status=${response.status} latency_ms=${latencyMs} resp_bytes=${text.length}`);

if (!response.ok) {
  console.log(`error body: ${text.slice(0, 500)}`);
  process.exit(1);
}

const parsed = parseSystemOneAxisExperimentResponse(request, MODEL, FIVE_AXIS_EXPERIMENT_AXES, text);
console.log(`metadata=${JSON.stringify(parsed.providerMetadata)}`);
console.log(`observations=${JSON.stringify(parsed.observations)}`);
console.log(`request_sha256=${sha256Digest(body)}`);
console.log(`response_sha256=${sha256Digest(text)}`);
