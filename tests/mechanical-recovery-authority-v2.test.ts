import { describe, expect, it } from 'vitest';
import {
  InMemoryCAS,
  createToolRecoveryManifest,
  decideSemanticPolicyV2,
  encodeToolEvidence,
  evaluateMechanicalRecovery,
  runObservationOnlyArmV2,
} from '../src/lab/index.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

const thresholds = {
  evidenceSufficientFloor: 0.8,
  retain: 0.5,
  keepFull: 0.8,
  reviewFloor: 0.8,
};

const profiles = {
  decision_contract: {
    id: 'anvil.context-retention.v2',
    version: '2.0.0',
    digest: d('a'),
  },
  execution_profile: {
    id: 'jev-fixture',
    version: '2.0.0',
    digest: d('b'),
  },
  calibration_profile: {
    id: 'fixture-cal',
    version: '2.0.0',
    digest: d('c'),
  },
  policy_profile: {
    id: 'fixture-policy',
    version: '2.0.0',
    digest: d('d'),
  },
};

function trace() {
  const stdout = 'head\nCRITICAL-MIDDLE\ntail';
  return {
    trace_id: 'v2-recovery-race',
    source_run_id: 'fixture-v2-recovery-race',
    shared_state: 'recovery authority must remain current',
    candidates: [{
      candidate_id: 'cand-a',
      stdout,
      stderr: '',
      exit_status: 0,
      head_lines: 1,
      tail_lines: 1,
      presentation_budget_bytes: 1000,
      recovery: createToolRecoveryManifest(
        stdout,
        '',
        0,
        'v2-recovery-race-object',
      ),
      critical_evidence: ['CRITICAL-MIDDLE'],
    }],
  };
}

function observation() {
  return {
    candidate_id: 'cand-a',
    evidence_sufficient: { noul: 0.95 },
    still_needed: { noul: 0.9 },
    full_content_needed: { noul: 0.1 },
    unresolved_evidence: { noul: 0.1 },
  };
}

function response(request: any) {
  return {
    schema: 'anvil.semantic-decision-response.v2',
    request_id: request.request_id,
    observations: [{
      candidate_id: 'cand-a',
      evidence_sufficient: { noul: 0.95 },
      still_needed: { noul: 0.9 },
      full_content_needed: { noul: 0.1 },
      unresolved_evidence: { noul: 0.1 },
    }],
  };
}

describe('V2 mechanical recovery authority freshness', () => {
  it('rejects a structural copy of otherwise valid recovery evidence', () => {
    const t = trace();
    const candidate = t.candidates[0];
    const cas = new InMemoryCAS();
    cas.put(
      'v2-recovery-race-object',
      encodeToolEvidence(candidate.stdout, '', 0),
    );
    const issued = evaluateMechanicalRecovery(cas, candidate);
    const forged = { ...issued };

    const result = decideSemanticPolicyV2({
      candidate,
      observation: observation(),
      thresholds,
      recovery: forged,
      currentStoreSnapshotDigest: cas.snapshotDigest(),
    } as any);

    expect(result.presentation.disposition).toBe('FULL');
    expect(result.decision.reason).toBe('mechanical_recovery_unavailable');
    expect(result.decision.recovery_failure_code)
      .toBe('unissued_recovery_evidence');
  });

  it('rejects an issued recovery proof after the CAS snapshot changes', () => {
    const t = trace();
    const candidate = t.candidates[0];
    const cas = new InMemoryCAS();
    cas.put(
      'v2-recovery-race-object',
      encodeToolEvidence(candidate.stdout, '', 0),
    );
    const issued = evaluateMechanicalRecovery(cas, candidate);

    cas.put('unrelated-object', 'CAS generation changed');

    const result = decideSemanticPolicyV2({
      candidate,
      observation: observation(),
      thresholds,
      recovery: issued,
      currentStoreSnapshotDigest: cas.snapshotDigest(),
    } as any);

    expect(result.presentation.disposition).toBe('FULL');
    expect(result.decision.reason).toBe('mechanical_recovery_unavailable');
    expect(result.decision.recovery_failure_code)
      .toBe('stale_recovery_snapshot');
  });

  it('re-evaluates recovery after an async provider mutates the CAS', async () => {
    const t = trace();
    const candidate = t.candidates[0];
    const cas = new InMemoryCAS();
    cas.put(
      'v2-recovery-race-object',
      encodeToolEvidence(candidate.stdout, '', 0),
    );

    const run = await runObservationOnlyArmV2(
      t,
      cas,
      profiles,
      thresholds,
      async (request) => {
        cas.put('v2-recovery-race-object', 'tampered while provider ran');
        return response(request);
      },
    );

    expect(run.observations).not.toBeNull();
    expect(run.presentations[0].disposition).toBe('FULL');
    expect(run.policy[0].reason).toBe('mechanical_recovery_unavailable');
    expect(run.mechanicalRecovery[0].status).toBe('UNAVAILABLE');
  });
});
