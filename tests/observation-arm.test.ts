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
  const create = exportedFunction('createToolRecoveryManifest');
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
      recovery: create(stdout, '', 0, 'observation-cand-1'),
      critical_evidence: ['CRITICAL-MIDDLE'],
    }],
  };
}

function response(request: any, values: Partial<Record<string, number>> = {}) {
  return {
    schema: 'anvil.mapped-decision-response.v1',
    request_id: request.request_id,
    observations: request.candidate_views.map((candidate: any) => ({
      candidate_id: candidate.candidate_id,
      evidence_sufficient: { noul: values.evidence_sufficient ?? 0.95 },
      still_needed: { noul: values.still_needed ?? 0.2 },
      full_content_needed: { noul: values.full_content_needed ?? 0.9 },
      unresolved_evidence: { noul: values.unresolved_evidence ?? 0.1 },
    })),
  };
}

describe('observation-only SIEVE candidate arm', () => {
  it('fails the whole semantic batch to pristine before policy on misalignment', async () => {
    const CAS = exportedValue('InMemoryCAS');
    const run = exportedFunction('runObservationOnlyArm');
    const t = trace();
    const cas = new CAS();
    const encode = exportedFunction('encodeToolEvidence');
    cas.put(
      'observation-cand-1',
      encode(t.candidates[0].stdout, t.candidates[0].stderr, t.candidates[0].exit_status),
    );

    const result = await run(t, cas, profiles(), thresholds, async (request: any) => ({
      ...response(request),
      observations: [],
    }));
    expect(result.presentations[0]).toMatchObject({ disposition: 'PRISTINE_FALLBACK' });
    expect(result.presentations[0].visible_text).toContain('CRITICAL-MIDDLE');
    expect(result.receipts[0]).toMatchObject({
      pristine_fallback: true,
      error_code: 'reassembly:cardinality_mismatch',
    });
  });

  it('keeps full content when evidence sufficiency is below floor', async () => {
    const CAS = exportedValue('InMemoryCAS');
    const run = exportedFunction('runObservationOnlyArm');
    const t = trace();
    const cas = new CAS();
    const encode = exportedFunction('encodeToolEvidence');
    cas.put(
      'observation-cand-1',
      encode(t.candidates[0].stdout, t.candidates[0].stderr, t.candidates[0].exit_status),
    );
    const result = await run(t, cas, profiles(), thresholds, async (request: any) =>
      response(request, { evidence_sufficient: 0.2, full_content_needed: 0.1 }));
    expect(result.presentations[0]).toMatchObject({ disposition: 'ABSTAIN' });
    expect(result.presentations[0].visible_text).toContain('CRITICAL-MIDDLE');
    expect(result.presentations[0].recovery_required).toBe(false);
  });

  it('keeps full content for unresolved evidence', async () => {
    const CAS = exportedValue('InMemoryCAS');
    const run = exportedFunction('runObservationOnlyArm');
    const t = trace();
    const cas = new CAS();
    const encode = exportedFunction('encodeToolEvidence');
    cas.put(
      'observation-cand-1',
      encode(t.candidates[0].stdout, t.candidates[0].stderr, t.candidates[0].exit_status),
    );
    const result = await run(t, cas, profiles(), thresholds, async (request: any) =>
      response(request, { unresolved_evidence: 0.95, full_content_needed: 0.1 }));
    expect(result.presentations[0]).toMatchObject({ disposition: 'FULL' });
  });

  it('semantic observer cannot override missing mechanical CAS recovery', async () => {
    const CAS = exportedValue('InMemoryCAS');
    const run = exportedFunction('runObservationOnlyArm');
    const t = trace();
    const result = await run(t, new CAS(), profiles(), thresholds, async (request: any) =>
      response(request, {
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
    const encode = exportedFunction('encodeToolEvidence');
    cas.put(
      'observation-cand-1',
      encode(t.candidates[0].stdout, t.candidates[0].stderr, t.candidates[0].exit_status),
    );
    const result = await run(t, cas, profiles(), thresholds, async (request: any) =>
      response(request, {
        full_content_needed: 0.1,
        unresolved_evidence: 0.1,
        still_needed: 0.9,
      }));
    expect(result.presentations[0].disposition).toBe('REFERENTIAL');
    expect(result.presentations[0].visible_text).toContain('recovery=cas:observation-cand-1');
  });

  it('uses exact omitted stdout bytes in the mapped semantic view', async () => {
    const CAS = exportedValue('InMemoryCAS');
    const run = exportedFunction('runObservationOnlyArm');
    const encode = exportedFunction('encodeToolEvidence');
    const carve = exportedFunction('carveHardRoots');
    const t = trace();
    const cas = new CAS();
    cas.put(
      'observation-cand-1',
      encode(t.candidates[0].stdout, t.candidates[0].stderr, t.candidates[0].exit_status),
    );

    let captured: any;
    await run(t, cas, profiles(), thresholds, async (request: any) => {
      captured = request;
      return response(request);
    });

    const carved = carve({
      exitStatus: t.candidates[0].exit_status,
      stdout: t.candidates[0].stdout,
      stderr: t.candidates[0].stderr,
      headLines: t.candidates[0].head_lines,
      tailLines: t.candidates[0].tail_lines,
      presentationBudgetBytes: t.candidates[0].presentation_budget_bytes,
    });
    expect(carved.kind).toBe('ELIGIBLE');
    expect(captured.candidate_views[0].semantic_view.omitted_bytes)
      .toBe(carved.omitted_stdout_bytes);
  });

  it('does not call the semantic provider when deterministic hard roots exceed budget', async () => {
    const CAS = exportedValue('InMemoryCAS');
    const run = exportedFunction('runObservationOnlyArm');
    const encode = exportedFunction('encodeToolEvidence');
    const t = trace();
    t.candidates[0].presentation_budget_bytes = 1;

    const cas = new CAS();
    cas.put(
      'observation-cand-1',
      encode(t.candidates[0].stdout, t.candidates[0].stderr, t.candidates[0].exit_status),
    );

    let providerCalls = 0;
    const result = await run(t, cas, profiles(), thresholds, async (request: any) => {
      providerCalls += 1;
      return response(request);
    });

    expect(providerCalls).toBe(0);
    expect(result.presentations[0]).toMatchObject({ disposition: 'PRISTINE_FALLBACK' });
    expect(result.presentations[0].visible_text).toContain('CRITICAL-MIDDLE');
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
  it('unwraps provider telemetry envelopes and binds model usage into the receipt', async () => {
    const CAS = exportedValue('InMemoryCAS');
    const run = exportedFunction('runObservationOnlyArm');
    const encode = exportedFunction('encodeToolEvidence');
    const t = trace();
    const cas = new CAS();
    cas.put(
      'observation-cand-1',
      encode(t.candidates[0].stdout, t.candidates[0].stderr, t.candidates[0].exit_status),
    );

    const result = await run(t, cas, profiles(), thresholds, async (request: any) => ({
      mapped_response: response(request, {
        full_content_needed: 0.95,
        unresolved_evidence: 0.95,
      }),
      provider_metadata: {
        requested_model: 'jev-1.13.0',
        effective_model: 'jev-1.13.0',
        input_tokens: 321,
        output_tokens: 54,
        cost_usd: null,
      },
    }));

    expect(result.presentations[0].disposition).toBe('FULL');
    expect(result.receipts[0]).toMatchObject({
      pristine_fallback: false,
      provider_model_requested: 'jev-1.13.0',
      provider_model_effective: 'jev-1.13.0',
      provider_usage: {
        input_tokens: 321,
        output_tokens: 54,
        cost_usd: null,
      },
    });
  });

  it('emits a bound replay receipt from the observation arm itself', async () => {
    const CAS = exportedValue('InMemoryCAS');
    const run = exportedFunction('runObservationOnlyArm');
    const verifyReceipt = exportedFunction('verifyReplayReceipt');
    const t = trace();
    const cas = new CAS();
    const encode = exportedFunction('encodeToolEvidence');
    cas.put(
      'observation-cand-1',
      encode(t.candidates[0].stdout, t.candidates[0].stderr, t.candidates[0].exit_status),
    );

    const result = await run(t, cas, profiles(), thresholds, async (request: any) =>
      response(request, {
        full_content_needed: 0.95,
        unresolved_evidence: 0.95,
        still_needed: 0.9,
      }));

    expect(result.receipts).toHaveLength(1);
    expect(verifyReceipt(result.receipts[0])).toBe(true);
    expect(result.receipts[0]).toMatchObject({
      trace_id: 'observation-trace',
      source_run_id: 'run-observation',
      arm: 'D',
      decision_contract_id: 'anvil.context-retention.v1',
      decision_contract_version: '0.1.0',
      decision_contract_digest: digest('a'),
      execution_profile_id: 'offline-fixture',
      execution_profile_version: '0.1.0',
      execution_profile_digest: digest('b'),
      calibration_profile_id: 'fixture-calibration',
      calibration_profile_version: '0.1.0',
      calibration_profile_digest: digest('c'),
      policy_profile_id: 'fixture-policy',
      policy_profile_version: '0.1.0',
      policy_profile_digest: digest('d'),
      ordered_candidate_ids: ['cand-0001'],
      provider_model_requested: 'offline-fixture',
      provider_model_effective: 'offline-fixture',
      pristine_fallback: false,
      error_code: null,
    });
    for (const key of [
      'receipt_id',
      'source_trace_digest',
      'shared_state_digest',
      'candidate_set_digest',
      'provider_request_digest',
      'provider_response_digest',
      'observation_set_digest',
      'hard_root_policy_digest',
      'recovery_manifest_digest',
      'provider_usage',
      'latency_ms',
      'receipt_digest',
    ]) {
      expect(result.receipts[0]).toHaveProperty(key);
    }
  });
});
