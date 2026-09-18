import { describe, expect, it } from 'vitest';
import {
  NOUL_RECORD_SCHEMA_V2,
  candidateViewDigestV2,
  createNoulFileProviderV2,
  neoLfmIdentityV2,
  validateNoulRecordV2,
  type NoulRecordV2,
} from '../src/lab/noul-file-provider-v2.js';
import {
  compileContextRetentionProgramV2,
  SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
  type SemanticDecisionRequestV2,
} from '../src/lab/semantic-contract-v2.js';
import {
  mechanicalLabelTargetsV2,
} from '../src/lab/campaign-corpus-v2.js';
import { campaignCorpus } from '../src/lab/campaign-corpus.js';
import {
  InMemoryCAS,
  createToolRecoveryManifest,
  encodeToolEvidence,
  sha256Digest,
} from '../src/lab/recovery.js';
import { runObservationOnlyArmV2 } from '../src/lab/observation-arm-v2.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

const profiles = {
  decision_contract: {
    id: 'anvil.context-retention.v2',
    version: '2.0.0',
    digest: d('a'),
  },
  execution_profile: { id: 'neo-lfm2.5-local-v2', version: '2.0.0', digest: d('b') },
  calibration_profile: { id: 'fixture-cal', version: '2.0.0', digest: d('c') },
  policy_profile: { id: 'fixture-policy', version: '2.0.0', digest: d('d') },
};

const program = compileContextRetentionProgramV2(profiles.decision_contract);

function trace() {
  const stdout = 'head\nCRITICAL-MIDDLE\ntail';
  return {
    trace_id: 'v2-trace',
    source_run_id: 'campaign-v2-trace',
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

function capturedRequest(t: ReturnType<typeof trace>): SemanticDecisionRequestV2 {
  const cas = new InMemoryCAS();
  cas.put(
    'v2-cand-a',
    encodeToolEvidence(t.candidates[0].stdout, '', 0),
  );
  const captured: SemanticDecisionRequestV2[] = [];
  return runObservationOnlyArmV2(
    t,
    cas,
    profiles,
    { evidenceSufficientFloor: 0, retain: 0.5, keepFull: 0.9, reviewFloor: 0.8 },
    (request: SemanticDecisionRequestV2) => {
      captured.push(request);
      return {
        schema: 'anvil.semantic-decision-response.v2',
        request_id: request.request_id,
        observations: request.candidate_views.map((c) => ({
          candidate_id: c.candidate_id,
          evidence_sufficient: { noul: 0.5 },
          still_needed: { noul: 0.5 },
          full_content_needed: { noul: 0.5 },
          unresolved_evidence: { noul: 0.5 },
        })),
      };
    },
  ).then(() => captured[0]);
}

function v2Record(request: SemanticDecisionRequestV2, over: Partial<NoulRecordV2> = {}): NoulRecordV2 {
  const view = request.candidate_views[0];
  const axes = {
    evidence_sufficient: 0.9,
    still_needed: 0.8,
    full_content_needed: 0.7,
    unresolved_evidence: 0.6,
  };
  const telemetry = Object.fromEntries(
    Object.keys(axes).map((a) => [a, {
      probs: { '12447': 0.9, '4547': 0.1 },
      abs: { '12447': 0.4, '4547': 0.02 },
    }]),
  );
  return {
    schema: NOUL_RECORD_SCHEMA_V2,
    candidateViewDigest: candidateViewDigestV2(request, view.candidate_id),
    requestId: request.request_id,
    candidateId: view.candidate_id,
    providerProfileDigest: 'sha256:' + '0'.repeat(64),
    axisProbabilities: axes,
    promptDigests: Object.fromEntries(
      Object.keys(axes).map((a) => [a, d('e')]),
    ),
    axisSpecDigest: d('f'),
    probeMode: 'conditional',
    yesTokenIds: [11683, 12447, 18171, 17550],
    noTokenIds: [2243, 4547, 794, 2752],
    telemetry,
    timingsMs: { prefill: 100, decode: 0 },
    ...over,
  } as NoulRecordV2;
}

describe('V2 measured lane — version boundaries fail closed', () => {
  it('rejects a V1 record at the V2 provider boundary', async () => {
    const t = trace();
    const request = await capturedRequest(t);
    const v1 = {
      schema: 'anvil.noul-observation.v1',
      candidateViewDigest: d('1'),
      requestId: request.request_id,
      candidateId: 'cand-a',
      axisProbabilities: {
        evidence_sufficient: 0.9, still_needed: 0.9,
        full_content_needed: 0.1, unresolved_evidence: 0.1, recoverable: 0.9,
      },
      probeMode: 'conditional',
      yesTokenIds: [12447],
      noTokenIds: [4547],
      promptDigests: {
        evidence_sufficient: d('2'), still_needed: d('2'),
        full_content_needed: d('2'), unresolved_evidence: d('2'),
        recoverable: d('2'),
      },
      timingsMs: { prefill: 1, decode: 0 },
    };
    expect(() => validateNoulRecordV2(v1)).toThrowError(/schema|v2/i);
    const provider = createNoulFileProviderV2([]);
    expect(provider).toBeTypeOf('function');
  });

  it('rejects a V2 record containing recoverable', async () => {
    const t = trace();
    const request = await capturedRequest(t);
    const rec = v2Record(request, {
      axisProbabilities: {
        evidence_sufficient: 0.9, still_needed: 0.8,
        full_content_needed: 0.7, unresolved_evidence: 0.6,
        recoverable: 0.99,
      } as never,
    });
    expect(() => validateNoulRecordV2(rec)).toThrowError(/recoverable|axis/i);
    const rec2 = v2Record(request, { recoverable: { noul: 1 } } as never);
    expect(() => validateNoulRecordV2(rec2)).toThrowError(/recoverable|unexpected/i);
  });

  it('rejects V1 prompt digests bound as V2 (four-axis, V2 digest shape)', async () => {
    const t = trace();
    const request = await capturedRequest(t);
    const rec = v2Record(request, {
      promptDigests: {
        evidence_sufficient: d('1'), still_needed: d('1'),
        full_content_needed: d('1'), unresolved_evidence: d('1'),
        recoverable: d('1'),
      } as never,
    });
    expect(() => validateNoulRecordV2(rec)).toThrowError(/prompt|recoverable|axis/i);
  });

  it('rejects a V1 candidate-view digest at provider binding', async () => {
    const t = trace();
    const request = await capturedRequest(t);
    const v1ViewDigest = sha256Digest(JSON.stringify({
      schema: 'anvil.noul-candidate-view.v1',
      requestId: request.request_id,
      candidateId: 'cand-a',
      sourceDigest: request.candidate_views[0].source_digest,
      hardRoots: request.candidate_views[0].hard_roots,
      semanticView: request.candidate_views[0].semantic_view,
      mission: request.shared_conversation_state.mission,
    }));
    const rec = v2Record(request, { candidateViewDigest: v1ViewDigest });
    const valid = validateNoulRecordV2(rec);
    const provider = createNoulFileProviderV2([valid]);
    expect(() => provider(request)).toThrowError(/view digest|mismatch/i);
    expect(v1ViewDigest).not.toBe(candidateViewDigestV2(request, 'cand-a'));
  });

  it('rejects a record missing one of the four V2 axes', async () => {
    const t = trace();
    const request = await capturedRequest(t);
    const rec = v2Record(request);
    delete (rec.axisProbabilities as Record<string, number>).unresolved_evidence;
    expect(() => validateNoulRecordV2(rec)).toThrowError(/unresolved_evidence|axis/i);
  });

  it('rejects duplicate candidate records', async () => {
    const t = trace();
    const request = await capturedRequest(t);
    const rec = validateNoulRecordV2(v2Record(request));
    expect(() => createNoulFileProviderV2([rec, rec])).toThrowError(/duplicate/i);
  });

  it('rejects stale/wrong provider profile digest at record validation', async () => {
    const t = trace();
    const request = await capturedRequest(t);
    const rec = v2Record(request, { providerProfileDigest: d('9') });
    const valid = validateNoulRecordV2(rec);
    const provider = createNoulFileProviderV2([valid], {
      expectedProfileDigest: 'sha256:' + '1'.repeat(64),
    });
    expect(() => provider(request)).toThrowError(/profile/i);
  });

  it('absolute-probability telemetry is preserved but cannot reach the response', async () => {
    const t = trace();
    const request = await capturedRequest(t);
    const rec = validateNoulRecordV2(v2Record(request));
    const provider = createNoulFileProviderV2([rec]);
    const response = provider(request) as {
      observations: Array<Record<string, unknown>>;
    };
    const obs = response.observations[0];
    for (const axis of Object.keys(obs)) {
      if (axis === 'candidate_id') continue;
      expect(Object.keys(obs[axis] as object)).toEqual(['noul']);
    }
    expect(obs).not.toHaveProperty('telemetry');
    expect(obs).not.toHaveProperty('abs');
    expect(obs).not.toHaveProperty('authority');
    expect(obs).not.toHaveProperty('recoverable');
    expect(validTelemetry(rec)).toBe(true);
  });

  it('missing evidence alone does not label unresolved_evidence true', () => {
    const corpus = campaignCorpus();
    // middle-placement candidates omit their critical marker from the carved
    // view — missing evidence — but the source carries no failure/warning/
    // contradiction/verification-gap evidence. V2: unresolved must stay 0.
    const missingOnly = corpus
      .flatMap((t) => t.candidates)
      .filter((c) =>
        c.critical_evidence.length > 0 &&
        c.exit_status === 0 &&
        c.stderr.length === 0 &&
        !c.stdout.split('\n').slice(0, c.head_lines).join('\n')
          .includes(c.critical_evidence[0]) &&
        !c.stdout.split('\n').slice(-c.tail_lines).join('\n')
          .includes(c.critical_evidence[0]) &&
        !/FAIL|error|warning|deprecated|use-after-free/i.test(c.stdout));
    expect(missingOnly.length).toBeGreaterThan(0);
    for (const cand of missingOnly) {
      const targets = mechanicalLabelTargetsV2(cand);
      expect(targets.unresolved_evidence).toBe(0);
      expect(targets.full_content_needed).toBe(1);
    }
    // and a genuinely unresolved candidate still labels 1
    const unresolved = corpus
      .flatMap((t) => t.candidates)
      .find((c) => c.exit_status !== 0 || c.stderr.length > 0);
    expect(unresolved).toBeDefined();
    expect(mechanicalLabelTargetsV2(unresolved!).unresolved_evidence).toBe(1);
  });
});

function validTelemetry(rec: NoulRecordV2): boolean {
  return Object.keys(rec.telemetry).length === 4 &&
    Object.values(rec.telemetry).every(
      (t) => typeof t.probs === 'object' && typeof t.abs === 'object',
    );
}

describe('V2 provider identity', () => {
  it('derives a V2-bound profile distinct from the V1 profile', () => {
    const v2 = neoLfmIdentityV2({
      packageDigest: d('1'),
      tokenizerDigest: d('2'),
      quantization: 'int4',
      backend: 'coreml-ane',
      runtimeVersion: 'macOS-27.2',
      compilerDigest: d('3'),
      contextWindow: 512,
      samplingDigest: d('4'),
    });
    expect(v2.observationABIDigest).toBe(SEMANTIC_OBSERVATION_ABI_DIGEST_V2);
    expect(v2.profile.providerId).toBe('neo-lfm2.5-local-v2');
    expect(v2.profile.providerProfileDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
