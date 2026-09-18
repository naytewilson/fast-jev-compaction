import { describe, expect, it } from 'vitest';
import {
  FOUR_AXIS_EXPERIMENT_AXES,
  FIVE_AXIS_EXPERIMENT_AXES,
  compareSharedAxisObservations,
  observationQuestionCount,
} from '../src/lab/semantic-abi-experiment.js';

describe('semantic ABI experiment harness', () => {
  it('keeps the five-axis historical experiment arm intact', () => {
    expect(FIVE_AXIS_EXPERIMENT_AXES).toEqual([
      'evidence_sufficient',
      'still_needed',
      'full_content_needed',
      'unresolved_evidence',
      'recoverable',
    ]);
  });

  it('defines a four-axis candidate arm without modeled recoverable', () => {
    expect(FOUR_AXIS_EXPERIMENT_AXES).toEqual([
      'evidence_sufficient',
      'still_needed',
      'full_content_needed',
      'unresolved_evidence',
    ]);
    expect(FOUR_AXIS_EXPERIMENT_AXES).not.toContain('recoverable');
  });

  it('computes question counts from candidate count and axis count', () => {
    expect(observationQuestionCount(3, FIVE_AXIS_EXPERIMENT_AXES)).toBe(15);
    expect(observationQuestionCount(3, FOUR_AXIS_EXPERIMENT_AXES)).toBe(12);
    expect(() => observationQuestionCount(-1, FOUR_AXIS_EXPERIMENT_AXES))
      .toThrow(/candidate/i);
  });

  it('compares only shared axes with deterministic candidate/axis ordering', () => {
    const deltas = compareSharedAxisObservations(
      [
        {
          candidateId: 'b',
          values: {
            evidence_sufficient: 0.7,
            still_needed: 0.8,
            full_content_needed: 0.4,
            unresolved_evidence: 0.2,
            recoverable: 0.99,
          },
        },
        {
          candidateId: 'a',
          values: {
            evidence_sufficient: 0.2,
            still_needed: 0.3,
            full_content_needed: 0.4,
            unresolved_evidence: 0.5,
            recoverable: 0.9,
          },
        },
      ],
      [
        {
          candidateId: 'a',
          values: {
            evidence_sufficient: 0.25,
            still_needed: 0.35,
            full_content_needed: 0.45,
            unresolved_evidence: 0.55,
          },
        },
        {
          candidateId: 'b',
          values: {
            evidence_sufficient: 0.65,
            still_needed: 0.75,
            full_content_needed: 0.35,
            unresolved_evidence: 0.15,
          },
        },
      ],
    );

    expect(deltas).toHaveLength(8);
    expect(deltas[0]).toEqual({
      candidateId: 'a',
      axis: 'evidence_sufficient',
      fiveAxisProbability: 0.2,
      fourAxisProbability: 0.25,
      absoluteDelta: 0.05,
    });
    expect(deltas.every((row) => row.axis !== ('recoverable' as any))).toBe(true);
  });

  it('fails closed when candidate sets or shared-axis values are incomplete', () => {
    expect(() => compareSharedAxisObservations(
      [{ candidateId: 'a', values: { evidence_sufficient: 0.2 } }],
      [{ candidateId: 'b', values: { evidence_sufficient: 0.2 } }],
    )).toThrow(/candidate/i);

    expect(() => compareSharedAxisObservations(
      [{ candidateId: 'a', values: { evidence_sufficient: 0.2 } }],
      [{ candidateId: 'a', values: { evidence_sufficient: 0.2 } }],
    )).toThrow(/axis/i);
  });
});


function experimentMappedRequest() {
  const digest = (c: string) => 'sha256:' + c.repeat(64);
  return {
    schema: 'anvil.mapped-decision-request.v0',
    request_id: 'mdr-axis-experiment',
    source_run_id: 'fixture-axis-experiment',
    decision_contract: {
      id: 'anvil.context-retention.v1',
      version: '0.1.0',
      digest: digest('a'),
    },
    execution_profile: {
      id: 'typesafe-systemone-jev-1.13.0',
      version: '0.1.0',
      digest: digest('b'),
    },
    calibration_profile: {
      id: 'fixture-calibration',
      version: '0.1.0',
      digest: digest('c'),
    },
    policy_profile: {
      id: 'fixture-policy',
      version: '0.1.0',
      digest: digest('d'),
    },
    shared_conversation_state: {
      mission: 'measure axis ablation',
      recent_turns: [],
      active_constraints: ['lab only'],
      unresolved_failures: [],
      source_refs: [digest('e')],
    },
    candidate_views: [{
      candidate_id: 'cand-0001',
      source_digest: digest('e'),
      source_kind: 'tool_result',
      recovery_ref: 'cas:fixture-axis-1',
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

describe('System One axis experiment payload', () => {
  it('holds state and shared question text constant while removing only recoverable', async () => {
    const module = await import('../src/lab/semantic-abi-experiment.js');
    const request = experimentMappedRequest() as any;
    const five = module.buildSystemOneAxisExperimentPayload(
      request,
      'jev-1.13.0',
      FIVE_AXIS_EXPERIMENT_AXES,
    );
    const four = module.buildSystemOneAxisExperimentPayload(
      request,
      'jev-1.13.0',
      FOUR_AXIS_EXPERIMENT_AXES,
    );

    expect(four.state).toEqual(five.state);
    expect(Object.keys(five.questions)).toHaveLength(5);
    expect(Object.keys(four.questions)).toEqual([
      'cand-0001.evidence_sufficient',
      'cand-0001.still_needed',
      'cand-0001.full_content_needed',
      'cand-0001.unresolved_evidence',
    ]);
    for (const key of Object.keys(four.questions)) {
      expect(four.questions[key]).toEqual(five.questions[key]);
    }
  });

  it('parses only the requested axes and preserves provider usage', async () => {
    const module = await import('../src/lab/semantic-abi-experiment.js');
    const request = experimentMappedRequest() as any;
    const payload = module.buildSystemOneAxisExperimentPayload(
      request,
      'jev-1.13.0',
      FOUR_AXIS_EXPERIMENT_AXES,
    );
    const answers = Object.fromEntries(
      Object.keys(payload.questions).map((key, index) => [
        key,
        { type: 'noul', noul: 0.2 + index * 0.1 },
      ]),
    );

    const result = module.parseSystemOneAxisExperimentResponse(
      request,
      'jev-1.13.0',
      FOUR_AXIS_EXPERIMENT_AXES,
      JSON.stringify({
        model: 'jev-1.13.0',
        answers,
        usage: { input_tokens: 101, output_tokens: 17 },
      }),
    );

    expect(result.observations).toEqual([{
      candidateId: 'cand-0001',
      values: {
        evidence_sufficient: 0.2,
        still_needed: 0.30000000000000004,
        full_content_needed: 0.4,
        unresolved_evidence: 0.5,
      },
    }]);
    expect(result.providerMetadata).toEqual({
      requested_model: 'jev-1.13.0',
      effective_model: 'jev-1.13.0',
      input_tokens: 101,
      output_tokens: 17,
      cost_usd: null,
    });
  });

  it('fails closed on extra answer keys or effective-model drift', async () => {
    const module = await import('../src/lab/semantic-abi-experiment.js');
    const request = experimentMappedRequest() as any;
    const payload = module.buildSystemOneAxisExperimentPayload(
      request,
      'jev-1.13.0',
      FOUR_AXIS_EXPERIMENT_AXES,
    );
    const answers = Object.fromEntries(
      Object.keys(payload.questions).map((key) => [key, { noul: 0.5 }]),
    );

    expect(() => module.parseSystemOneAxisExperimentResponse(
      request,
      'jev-1.13.0',
      FOUR_AXIS_EXPERIMENT_AXES,
      JSON.stringify({
        model: 'jev-1.13.0',
        answers: { ...answers, extra: { noul: 0.5 } },
      }),
    )).toThrow(/key/i);

    expect(() => module.parseSystemOneAxisExperimentResponse(
      request,
      'jev-1.13.0',
      FOUR_AXIS_EXPERIMENT_AXES,
      JSON.stringify({
        model: 'jev-1.13.1',
        answers,
      }),
    )).toThrow(/model/i);
  });
});
