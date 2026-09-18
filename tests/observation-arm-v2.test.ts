import { describe, expect, it } from 'vitest';
import {
  runObservationOnlyArmV2,
  type ObservationPolicyThresholdsV2,
} from '../src/lab/observation-arm-v2.js';
import {
  InMemoryCAS,
  createToolRecoveryManifest,
  encodeToolEvidence,
} from '../src/lab/recovery.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

const thresholds: ObservationPolicyThresholdsV2 = {
  evidenceSufficientFloor: 0.8,
  retain: 0.5,
  keepFull: 0.8,
  reviewFloor: 0.8,
};

const profiles = {
  decision_contract: { id: 'anvil.context-retention.v2', version: '2.0.0', digest: d('a') },
  execution_profile: { id: 'jev-fixture', version: '2.0.0', digest: d('b') },
  calibration_profile: { id: 'fixture-cal', version: '2.0.0', digest: d('c') },
  policy_profile: { id: 'fixture-policy', version: '2.0.0', digest: d('d') },
};

function trace() {
  const stdout = 'head\nCRITICAL-MIDDLE\ntail';
  return {
    trace_id: 'v2-trace',
    source_run_id: 'fixture-v2-trace',
    shared_state: 'preserve source-bound evidence',
    candidates: [{
      candidate_id: 'cand-a',
      stdout,
      stderr: '',
      exit_status: 0,
      head_lines: 1,
      tail_lines: 1,
      presentation_budget_bytes: 1000,
      recovery: createToolRecoveryManifest(stdout, '', 0, 'v2-cand-a'),
      critical_evidence: ['CRITICAL-MIDDLE'],
    }],
  };
}

function response(request: any, patch: Record<string, number> = {}) {
  return {
    schema: 'anvil.semantic-decision-response.v2',
    request_id: request.request_id,
    observations: [{
      candidate_id: 'cand-a',
      evidence_sufficient: { noul: patch.evidence_sufficient ?? 0.95 },
      still_needed: { noul: patch.still_needed ?? 0.9 },
      full_content_needed: { noul: patch.full_content_needed ?? 0.1 },
      unresolved_evidence: { noul: patch.unresolved_evidence ?? 0.1 },
    }],
  };
}

describe('Semantic Fabric V2 authority-preserving observation arm', () => {
  it('uses mechanical recovery for referential presentation', async () => {
    const t = trace();
    const cas = new InMemoryCAS();
    cas.put(
      'v2-cand-a',
      encodeToolEvidence(t.candidates[0].stdout, '', 0),
    );

    const run = await runObservationOnlyArmV2(
      t,
      cas,
      profiles,
      thresholds,
      async (request) => response(request),
    );

    expect(run.presentations[0].disposition).toBe('REFERENTIAL');
    expect(run.mechanicalRecovery[0]).toMatchObject({
      candidate_id: 'cand-a',
      status: 'VERIFIED',
    });
    expect(run.observations?.[0]).not.toHaveProperty('recoverable');
  });

  it('cannot obtain recovery authority from model output when CAS verification fails', async () => {
    const t = trace();
    const run = await runObservationOnlyArmV2(
      t,
      new InMemoryCAS(),
      profiles,
      thresholds,
      async (request) => ({
        ...response(request),
        observations: [{
          ...response(request).observations[0],
          recoverable: { noul: 1 },
        }],
      }),
    );

    expect(run.presentations[0].disposition).toBe('PRISTINE_FALLBACK');
    expect(run.observations).toBeNull();
  });

  it('records mechanical recovery even when the semantic provider fails', async () => {
    const t = trace();
    const cas = new InMemoryCAS();
    cas.put('v2-cand-a', encodeToolEvidence(t.candidates[0].stdout, '', 0));

    const run = await runObservationOnlyArmV2(
      t,
      cas,
      profiles,
      thresholds,
      async () => { throw new Error('offline'); },
    );

    expect(run.presentations[0].disposition).toBe('PRISTINE_FALLBACK');
    expect(run.observations).toBeNull();
    expect(run.mechanicalRecovery).toEqual([
      expect.objectContaining({
        candidate_id: 'cand-a',
        status: 'VERIFIED',
      }),
    ]);
    expect(run.receipts[0].error_code).toBe('provider_exception');
  });

  it('short-circuits semantic authority on insufficient evidence before unresolved advice', async () => {
    const t = trace();
    const cas = new InMemoryCAS();
    cas.put('v2-cand-a', encodeToolEvidence(t.candidates[0].stdout, '', 0));

    const run = await runObservationOnlyArmV2(
      t,
      cas,
      profiles,
      thresholds,
      async (request) => response(request, {
        evidence_sufficient: 0.2,
        still_needed: 1,
        full_content_needed: 0,
        unresolved_evidence: 1,
      }),
    );

    expect(run.presentations[0].disposition).toBe('ABSTAIN');
    expect(run.policy[0]).toMatchObject({
      semantic_authority_used: false,
      review_advisory: false,
      reason: 'insufficient_evidence',
    });
  });

  it('treats unresolved evidence as review advice only after the evidence gate', async () => {
    const t = trace();
    const cas = new InMemoryCAS();
    cas.put('v2-cand-a', encodeToolEvidence(t.candidates[0].stdout, '', 0));

    const run = await runObservationOnlyArmV2(
      t,
      cas,
      profiles,
      thresholds,
      async (request) => response(request, {
        evidence_sufficient: 0.95,
        still_needed: 0.9,
        full_content_needed: 0.1,
        unresolved_evidence: 0.95,
      }),
    );

    expect(run.presentations[0].disposition).toBe('FULL');
    expect(run.policy[0]).toMatchObject({
      semantic_authority_used: true,
      review_advisory: true,
      reason: 'review_advisory',
    });
  });

  it('lets still_needed drive safe eviction only when exact mechanical recovery exists', async () => {
    const t = trace();
    const cas = new InMemoryCAS();
    cas.put('v2-cand-a', encodeToolEvidence(t.candidates[0].stdout, '', 0));

    const evicted = await runObservationOnlyArmV2(
      t,
      cas,
      profiles,
      thresholds,
      async (request) => response(request, {
        evidence_sufficient: 0.95,
        still_needed: 0.1,
        full_content_needed: 0.1,
        unresolved_evidence: 0.1,
      }),
    );
    expect(evicted.presentations[0].disposition).toBe('EVICTED');

    const kept = await runObservationOnlyArmV2(
      t,
      new InMemoryCAS(),
      profiles,
      thresholds,
      async (request) => response(request, {
        evidence_sufficient: 0.95,
        still_needed: 0.1,
        full_content_needed: 0.1,
        unresolved_evidence: 0.1,
      }),
    );
    expect(kept.presentations[0].disposition).toBe('FULL');
    expect(kept.policy[0].reason).toBe('mechanical_recovery_unavailable');
  });
});
