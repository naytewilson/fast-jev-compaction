import { describe, expect, it } from 'vitest';
import {
  MAPPED_OBSERVATION_AXES,
  compileContextRetentionProgram,
  createSystemOneMappedProvider,
  authorizeSyntheticFixtureEgress,
  reassembleMappedObservations,
  runObservationOnlyArm,
  InMemoryCAS,
  createToolRecoveryManifest,
  encodeToolEvidence,
  validateSemanticObservationEnvelope,
} from '../src/lab/index.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

function mappedRequest() {
  return {
    schema: 'anvil.mapped-decision-request.v1',
    request_id: 'mdr-abi-v2',
    source_run_id: 'fixture-abi-v2',
    decision_contract: { id: 'anvil.context-retention.v2', version: '2.0.0', digest: d('a') },
    execution_profile: { id: 'jev-1.13.0', version: '1.0.0', digest: d('b') },
    calibration_profile: { id: 'shadow', version: '1.0.0', digest: d('c') },
    policy_profile: { id: 'shadow-policy', version: '1.0.0', digest: d('d') },
    shared_conversation_state: {
      mission: 'preserve evidence',
      recent_turns: [],
      active_constraints: ['mechanical recovery owns recoverability'],
      unresolved_failures: [],
      source_refs: [d('e')],
    },
    candidate_views: [{
      candidate_id: 'cand-0001',
      source_digest: d('e'),
      source_kind: 'tool_result' as const,
      recovery_ref: 'cas:fixture-abi-v2',
      byte_count: 100,
      hard_roots: {
        exit_status: 0,
        stderr: [],
        first_lines: ['head'],
        last_lines: ['tail'],
      },
      semantic_view: {
        head: 'head',
        tail: 'tail',
        selected_chunks: [],
        omitted_bytes: 80,
      },
    }],
  };
}

function semanticObservation(candidate_id = 'cand-0001') {
  return {
    candidate_id,
    evidence_sufficient: { noul: 0.95 },
    still_needed: { noul: 0.9 },
    full_content_needed: { noul: 0.1 },
    unresolved_evidence: { noul: 0.1 },
  };
}

describe('Semantic Observation ABI v2 mechanical recovery boundary', () => {
  it('contains exactly four modeled semantic predicates', () => {
    expect(MAPPED_OBSERVATION_AXES).toEqual([
      'evidence_sufficient',
      'still_needed',
      'full_content_needed',
      'unresolved_evidence',
    ]);
  });

  it('uses ABI v2 without a modeled recoverable predicate', () => {
    const expected = {
      candidateId: 'cand-0001',
      originalOrdinal: 0,
      sourceDigest: d('a'),
      programDigest: d('b'),
    };
    const valid = {
      schema: 'anvil.semantic-observation-abi.v2',
      ...expected,
      evidenceSufficient: 0.95,
      predicates: {
        stillNeeded: 0.9,
        fullContentNeeded: 0.1,
        unresolvedEvidence: 0.1,
      },
      telemetry: { entropy: null, margin: null },
    };
    expect(validateSemanticObservationEnvelope(expected, valid)).toEqual({ ok: true });
    expect(validateSemanticObservationEnvelope(expected, {
      ...valid,
      predicates: { ...valid.predicates, recoverable: 0.99 },
    }).ok).toBe(false);
  });

  it('strictly rejects legacy semantic recoverable in mapped responses', () => {
    const ok = reassembleMappedObservations(
      'mdr-abi-v2',
      ['cand-0001'],
      {
        schema: 'anvil.mapped-decision-response.v1',
        request_id: 'mdr-abi-v2',
        observations: [semanticObservation()],
      },
    );
    expect(ok.kind).toBe('OBSERVATIONS');

    const legacy = reassembleMappedObservations(
      'mdr-abi-v2',
      ['cand-0001'],
      {
        schema: 'anvil.mapped-decision-response.v1',
        request_id: 'mdr-abi-v2',
        observations: [{ ...semanticObservation(), recoverable: { noul: 1 } }],
      },
    );
    expect(legacy.kind).toBe('PRISTINE_FALLBACK');
  });

  it('compiles a four-predicate v2 semantic program', () => {
    const program = compileContextRetentionProgram({
      id: 'anvil.context-retention.v2',
      version: '2.0.0',
      digest: d('a'),
    });
    expect(program.observationABIVersion).toBe('anvil.semantic-observation-abi.v2');
    expect(program.predicates.map((predicate) => predicate.id)).toEqual(MAPPED_OBSERVATION_AXES);
    expect(program.predicates).toHaveLength(4);
  });

  it('asks System One only the four semantic questions and bumps mapped schemas', async () => {
    const request = mappedRequest();
    let body: any;
    const provider = createSystemOneMappedProvider({
      apiKey: 'test-key',
      model: 'jev-1.13.0',
      egressGrants: [authorizeSyntheticFixtureEgress(request as any)],
      fetch: async (_url: string, init: any) => {
        body = JSON.parse(init.body);
        const answers = Object.fromEntries(
          Object.keys(body.questions).map((key) => [key, { type: 'noul', noul: 0.9 }]),
        );
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ model: 'jev-1.13.0', answers }),
        };
      },
    });

    const result = await provider(request as any);
    expect(body.state.schema).toBe('anvil.system-one-mapped-state.v1');
    expect(Object.keys(body.questions)).toEqual([
      'cand-0001.evidence_sufficient',
      'cand-0001.still_needed',
      'cand-0001.full_content_needed',
      'cand-0001.unresolved_evidence',
    ]);
    expect(result.mapped_response.schema).toBe('anvil.mapped-decision-response.v1');
  });

  it('uses mechanical CAS verification as the only recovery gate', async () => {
    const stdout = 'head\ncritical middle\ntail';
    const recovery = createToolRecoveryManifest(stdout, '', 0, 'abi-v2-recovery');
    const trace = {
      trace_id: 'abi-v2',
      source_run_id: 'run-abi-v2',
      shared_state: 'preserve exact evidence',
      candidates: [{
        candidate_id: 'cand-0001',
        stdout,
        stderr: '',
        exit_status: 0,
        head_lines: 1,
        tail_lines: 1,
        presentation_budget_bytes: 1000,
        recovery,
        critical_evidence: ['critical middle'],
      }],
    };
    const profiles = {
      decision_contract: { id: 'anvil.context-retention.v2', version: '2.0.0', digest: d('a') },
      execution_profile: { id: 'fixture', version: '1.0.0', digest: d('b') },
      calibration_profile: { id: 'shadow', version: '1.0.0', digest: d('c') },
      policy_profile: { id: 'shadow', version: '1.0.0', digest: d('d') },
    };
    const thresholds = { evidenceSufficientFloor: 0.8, keepFull: 0.8, retain: 0.5 };
    const provider = async (request: any) => ({
      schema: 'anvil.mapped-decision-response.v1',
      request_id: request.request_id,
      observations: [semanticObservation()],
    });

    const missing = await runObservationOnlyArm(
      trace as any,
      new InMemoryCAS(),
      profiles,
      thresholds,
      provider,
    );
    expect(missing.presentations[0].disposition).toBe('FULL');

    const cas = new InMemoryCAS();
    cas.put('abi-v2-recovery', encodeToolEvidence(stdout, '', 0));
    const verified = await runObservationOnlyArm(
      trace as any,
      cas,
      profiles,
      thresholds,
      provider,
    );
    expect(verified.presentations[0].disposition).toBe('REFERENTIAL');
  });
});
