import { describe, expect, it } from 'vitest';
import {
  candidateViewDigest,
  createNoulFileProvider,
  deriveNoulNormalizerDigest,
  deriveObservationABIDigest,
  neoLfmIdentity,
  validateNoulRecord,
  type NoulRecord,
} from '../src/lab/noul-file-provider.js';
import { verifyProviderExecutionProfile } from '../src/lab/provider-profile.js';
import { verifyLocalModelIdentity, verifyExecutionSemanticsIdentity } from '../src/lab/execution-profile.js';
import { MAPPED_OBSERVATION_AXES } from '../src/lab/types.js';
import type { MappedDecisionRequest } from '../src/lab/types.js';
import { sha256Digest } from '../src/lab/recovery.js';

const d = (c: string) => `sha256:${c.repeat(64)}` as const;

function fakeRequest(candidateIds: string[]): MappedDecisionRequest {
  return {
    schema: 'anvil.mapped-decision-request.v0',
    request_id: 'mdr-test-1',
    source_run_id: 'run-1',
    decision_contract: { id: 'c', version: '1', digest: d('1') },
    execution_profile: { id: 'e', version: '1', digest: d('2') },
    calibration_profile: { id: 'k', version: '1', digest: d('3') },
    policy_profile: { id: 'p', version: '1', digest: d('4') },
    shared_conversation_state: {
      mission: 'm',
      recent_turns: [],
      active_constraints: [],
      unresolved_failures: [],
      source_refs: candidateIds.map(() => d('9')),
    },
    candidate_views: candidateIds.map((id) => ({
      candidate_id: id,
      source_digest: d('9'),
      source_kind: 'tool_result' as const,
      recovery_ref: 'r',
      byte_count: 10,
      hard_roots: {
        exit_status: 0,
        stderr: [],
        first_lines: ['a'],
        last_lines: ['b'],
      },
      semantic_view: { head: 'a', tail: 'b', selected_chunks: [], omitted_bytes: 5 },
    })),
  };
}

function recordFor(request: MappedDecisionRequest, candidateId: string): NoulRecord {
  return {
    schema: 'anvil.noul-observation.v1',
    candidateViewDigest: candidateViewDigest(request, candidateId),
    requestId: request.request_id,
    candidateId,
    axisProbabilities: Object.fromEntries(MAPPED_OBSERVATION_AXES.map((a, i) => [a, 0.1 * (i + 1)])),
    probeMode: 'conditional',
    yesTokenIds: [11683],
    noTokenIds: [2243],
    promptDigests: Object.fromEntries(MAPPED_OBSERVATION_AXES.map((a) => [a, sha256Digest(`p-${a}`)])),
    timingsMs: { prefill: 1, decode: 1 },
  };
}

describe('noul file provider', () => {
  it('serves measured probabilities bound to request and view', async () => {
    const request = fakeRequest(['c1', 'c2']);
    const records = [recordFor(request, 'c1'), recordFor(request, 'c2')];
    const provider = createNoulFileProvider(records);
    const response = await provider(request) as {
      request_id: string;
      observations: Array<{ candidate_id: string; evidence_sufficient: { noul: number } }>;
    };
    expect(response.request_id).toBe('mdr-test-1');
    expect(response.observations).toHaveLength(2);
    expect(response.observations[0].evidence_sufficient.noul).toBeCloseTo(0.1);
    expect(response.observations[1].evidence_sufficient.noul).toBeCloseTo(0.1);
  });

  it('fails closed when a record is missing', async () => {
    const request = fakeRequest(['c1', 'c2']);
    const provider = createNoulFileProvider([recordFor(request, 'c1')]);
    expect(() => provider(request)).toThrow("no measured noul record");
  });

  it('fails closed when runner saw different view bytes', async () => {
    const request = fakeRequest(['c1']);
    const record = recordFor(request, 'c1');
    record.candidateViewDigest = d('f');
    const provider = createNoulFileProvider([record]);
    expect(() => provider(request)).toThrow("view digest mismatch");
  });

  it('rejects out-of-range probabilities', () => {
    const request = fakeRequest(['c1']);
    const record = recordFor(request, 'c1');
    record.axisProbabilities.evidence_sufficient = 1.5;
    expect(() => validateNoulRecord(record)).toThrow('bad probability');
  });
});

describe('neo LFM identity', () => {
  it('derives verifiable model, semantics and provider profile', () => {
    const identity = neoLfmIdentity({
      packageDigest: d('a'),
      tokenizerDigest: d('b'),
      weightsDigest: d('c'),
      quantization: 'palettized-4bit',
      backend: 'coreml-ane',
      runtimeVersion: 'CoreML 27.2',
      compilerDigest: d('d'),
      contextWindow: 512,
      samplingDigest: d('e'),
      hardwareSemanticsClass: 'a18pro-ane',
    });
    expect(verifyLocalModelIdentity(identity.model)).toBe(true);
    expect(verifyExecutionSemanticsIdentity(identity.semantics)).toBe(true);
    expect(verifyProviderExecutionProfile(identity.profile)).toBe(true);
    expect(identity.profile.providerId).toBe('neo-lfm2.5-local');
    expect(identity.profile.modelAssurance).toBe('contentVerified');
    expect(identity.normalizerDigest).toBe(deriveNoulNormalizerDigest());
    expect(identity.observationABIDigest).toBe(deriveObservationABIDigest());
  });
});
