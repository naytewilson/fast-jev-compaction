import { describe, expect, it } from 'vitest';
import { exportedFunction, exportedValue } from './lab-test-helpers.js';

const digest = (c: string) => 'sha256:' + c.repeat(64);

function profiles() {
  return {
    decision_contract: { id: 'anvil.context-retention.v1', version: '0.1.0', digest: digest('a') },
    execution_profile: { id: 'offline-fixture', version: '0.1.0', digest: digest('b') },
    calibration_profile: { id: 'fixture-calibration', version: '0.1.0', digest: digest('c') },
    policy_profile: { id: 'fixture-policy', version: '0.1.0', digest: digest('d') },
  };
}

const thresholds = {
  evidenceSufficientFloor: 0.8,
  keepFull: 0.8,
  retain: 0.5,
};

function trace() {
  const create = exportedFunction('createRecoveryManifest');
  const stdout = 'head\nCRITICAL-MIDDLE\ntail';
  return {
    trace_id: 'observation-trace',
    source_run_id: 'run-observation',
    shared_state: 'preserve critical evidence',
    candidates: [{
      candidate_id: 'cand-0001',
      stdout,
      stderr: '',
      exit_status: 0,
      head_lines: 1,
      tail_lines: 1,
      presentation_budget_bytes: 1000,
      recovery: create(stdout, 'observation-cand-1'),
      critical_evidence: ['CRITICAL-MIDDLE'],
    }],
  };
}

function response(request: any, values: Partial<Record<string, number>> = {}) {
  return {
    schema: 'anvil.mapped-decision-response.v0',
    request_id: request.request_id,
    observations: request.candidate_views.map((candidate: any) => ({
      candidate_id: candidate.candidate_id,
      evidence_sufficient: { noul: values.evidence_sufficient ?? 0.95 },
      still_needed: { noul: values.still_needed ?? 0.2 },
      full_content_needed: { noul: values.full_content_needed ?? 0.9 },
      unresolved_evidence: { noul: values.unresolved_evidence ?? 0.1 },
      recoverable: { noul: values.recoverable ?? 0.99 },
    })),
  };
}

describe('observation-only SIEVE candidate arm', () => {
  it('fails the whole semantic batch to pristine before policy on misalignment', async () => {
    const CAS = exportedValue('InMemoryCAS');
    const run = exportedFunction('runObservationOnlyArm');
    const t = trace();
    const cas = new CAS();
    cas.put('observation-cand-1', t.candidates[0].stdout);

    const result = await run(t, cas, profiles(), thresholds, async (request: any) => ({
      ...response(request),
      observations: [],
    }));
    expect(result.presentations[0]).toMatchObject({ disposition: 'PRISTINE_FALLBACK' });
    expect(result.presentations[0].visible_text).toContain('CRITICAL-MIDDLE');
  });

  it('keeps full content when evidence sufficiency is below floor', async () => {
    const CAS = exportedValue('InMemoryCAS');
    const run = exportedFunction('runObservationOnlyArm');
    const t = trace();
    const cas = new CAS();
    cas.put('observation-cand-1', t.candidates[0].stdout);
    const result = await run(t, cas, profiles(), thresholds, async (request: any) =>
      response(request, { evidence_sufficient: 0.2, full_content_needed: 0.1 }));
    expect(result.presentations[0]).toMatchObject({ disposition: 'FULL' });
  });

  it('keeps full content for unresolved evidence', async () => {
    const CAS = exportedValue('InMemoryCAS');
    const run = exportedFunction('runObservationOnlyArm');
    const t = trace();
    const cas = new CAS();
    cas.put('observation-cand-1', t.candidates[0].stdout);
    const result = await run(t, cas, profiles(), thresholds, async (request: any) =>
      response(request, { unresolved_evidence: 0.95, full_content_needed: 0.1 }));
    expect(result.presentations[0]).toMatchObject({ disposition: 'FULL' });
  });

  it('semantic recoverable cannot override missing mechanical CAS recovery', async () => {
    const CAS = exportedValue('InMemoryCAS');
    const run = exportedFunction('runObservationOnlyArm');
    const t = trace();
    const result = await run(t, new CAS(), profiles(), thresholds, async (request: any) =>
      response(request, {
        recoverable: 1,
        full_content_needed: 0.1,
        still_needed: 0.9,
      }));
    expect(result.presentations[0]).toMatchObject({ disposition: 'FULL' });
    expect(result.presentations[0].visible_text).toContain('CRITICAL-MIDDLE');
  });

  it('creates exact CAS referential views only after mechanical recovery verifies', async () => {
    const CAS = exportedValue('InMemoryCAS');
    const run = exportedFunction('runObservationOnlyArm');
    const t = trace();
    const cas = new CAS();
    cas.put('observation-cand-1', t.candidates[0].stdout);
    const result = await run(t, cas, profiles(), thresholds, async (request: any) =>
      response(request, {
        full_content_needed: 0.1,
        unresolved_evidence: 0.1,
        still_needed: 0.9,
      }));
    expect(result.presentations[0].disposition).toBe('REFERENTIAL');
    expect(result.presentations[0].visible_text).toContain('recovery=cas:observation-cand-1');
  });

  it('binds receipt digest to semantic identity and contains no credentials or question text', async () => {
    const createReceipt = exportedFunction('createReplayReceipt');
    const verifyReceipt = exportedFunction('verifyReplayReceipt');
    const base = {
      receipt_schema: 'anvil.semantic-retention-replay-receipt.v0',
      trace_id: 'trace',
      source_run_id: 'run',
      arm: 'D',
      decision_contract_digest: digest('a'),
      execution_profile_digest: digest('b'),
      calibration_profile_digest: digest('c'),
      policy_profile_digest: digest('d'),
      candidate_set_digest: digest('e'),
      observation_set_digest: digest('f'),
      dispositions: ['FULL'],
    };
    const a = createReceipt(base);
    const b = createReceipt({ ...base, dispositions: ['REFERENTIAL'] });
    expect(a.receipt_digest).not.toBe(b.receipt_digest);
    expect(verifyReceipt(a)).toBe(true);
    const serialized = JSON.stringify(a);
    expect(serialized).not.toMatch(/api[_-]?key|bearer|question/i);
  });
});
