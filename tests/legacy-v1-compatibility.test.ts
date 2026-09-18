import { describe, expect, it } from 'vitest';
import {
  LEGACY_MAPPED_DECISION_REQUEST_SCHEMA_V0,
  LEGACY_MAPPED_DECISION_RESPONSE_SCHEMA_V0,
  LEGACY_MAPPED_OBSERVATION_AXES_V1,
  LEGACY_SEMANTIC_OBSERVATION_ABI_V1,
  compileLegacyContextRetentionProgramV1,
  detectSemanticObservationABIVersion,
  reassembleLegacyMappedObservationsV0,
  validateLegacyMappedDecisionRequestV0,
  validateLegacySemanticObservationEnvelopeV1,
  validateVersionedSemanticObservationEnvelope,
} from '../src/lab/legacy-v1.js';
import { validateMappedDecisionRequest } from '../src/lab/mapped-contract.js';
import { validateSemanticObservationEnvelope } from '../src/lab/observation-abi.js';
import { reassembleMappedObservations } from '../src/lab/reassembler.js';
import { MAPPED_OBSERVATION_AXES } from '../src/lab/types.js';

const digest = (c: string) => 'sha256:' + c.repeat(64);

const expectedLane = {
  candidateId: 'cand-a',
  originalOrdinal: 0,
  sourceDigest: digest('b'),
  programDigest: digest('c'),
};

const legacyEnvelope = {
  schema: LEGACY_SEMANTIC_OBSERVATION_ABI_V1,
  ...expectedLane,
  evidenceSufficient: 0.9,
  predicates: {
    stillNeeded: 0.8,
    fullContentNeeded: 0.2,
    unresolvedEvidence: 0.1,
    recoverable: 0.99,
  },
  telemetry: {
    entropy: null,
    margin: null,
  },
};

const legacyRequest = {
  schema: LEGACY_MAPPED_DECISION_REQUEST_SCHEMA_V0,
  request_id: 'legacy-request',
  source_run_id: 'fixture-legacy',
  decision_contract: {
    id: 'anvil.context-retention.v1',
    version: '1.0.0',
    digest: digest('a'),
  },
  execution_profile: {
    id: 'legacy-execution',
    version: '1',
    digest: digest('b'),
  },
  calibration_profile: {
    id: 'legacy-calibration',
    version: '1',
    digest: digest('c'),
  },
  policy_profile: {
    id: 'legacy-policy',
    version: '1',
    digest: digest('d'),
  },
  shared_conversation_state: {
    mission: 'replay historical five-axis evidence',
    recent_turns: [],
    active_constraints: [],
    unresolved_failures: [],
    source_refs: [digest('b')],
  },
  candidate_views: [{
    candidate_id: 'cand-a',
    source_digest: digest('b'),
    source_kind: 'tool_result' as const,
    recovery_ref: 'cas:legacy-a',
    byte_count: 5,
    hard_roots: {
      exit_status: 0,
      stderr: [],
      first_lines: ['alpha'],
      last_lines: ['alpha'],
    },
    semantic_view: {
      head: 'alpha',
      tail: 'alpha',
      selected_chunks: [],
      omitted_bytes: 0,
    },
  }],
};

const legacyResponse = {
  schema: LEGACY_MAPPED_DECISION_RESPONSE_SCHEMA_V0,
  request_id: 'legacy-request',
  observations: [{
    candidate_id: 'cand-a',
    evidence_sufficient: { noul: 0.9 },
    still_needed: { noul: 0.8 },
    full_content_needed: { noul: 0.2 },
    unresolved_evidence: { noul: 0.1 },
    recoverable: { noul: 0.99 },
  }],
};

describe('legacy semantic observation v1 compatibility', () => {
  it('keeps five-axis v1 and four-axis v2 as separate namespaces', () => {
    expect(LEGACY_MAPPED_OBSERVATION_AXES_V1).toEqual([
      'evidence_sufficient',
      'still_needed',
      'full_content_needed',
      'unresolved_evidence',
      'recoverable',
    ]);
    expect(MAPPED_OBSERVATION_AXES).toEqual([
      'evidence_sufficient',
      'still_needed',
      'full_content_needed',
      'unresolved_evidence',
    ]);
  });

  it('validates historical v1 observations without admitting them as v2', () => {
    expect(
      validateLegacySemanticObservationEnvelopeV1(expectedLane, legacyEnvelope),
    ).toEqual({ ok: true });
    expect(
      validateSemanticObservationEnvelope(expectedLane, legacyEnvelope).ok,
    ).toBe(false);
    expect(detectSemanticObservationABIVersion(legacyEnvelope)).toBe('v1');
    expect(
      validateVersionedSemanticObservationEnvelope(expectedLane, legacyEnvelope),
    ).toEqual({ ok: true });
  });

  it('strictly validates historical mapped request v0 without changing its identity', () => {
    expect(validateLegacyMappedDecisionRequestV0(legacyRequest)).toEqual({ ok: true });
    expect(validateMappedDecisionRequest(legacyRequest).ok).toBe(false);
    expect(legacyRequest.schema).toBe('anvil.mapped-decision-request.v0');
  });

  it('reassembles historical five-axis responses and preserves recoverable as legacy evidence only', () => {
    const legacy = reassembleLegacyMappedObservationsV0(
      'legacy-request',
      ['cand-a'],
      legacyResponse,
    );
    expect(legacy.kind).toBe('OBSERVATIONS');
    if (legacy.kind === 'OBSERVATIONS') {
      expect(legacy.observations[0].recoverable.noul).toBe(0.99);
    }

    expect(
      reassembleMappedObservations('legacy-request', ['cand-a'], legacyResponse).kind,
    ).toBe('PRISTINE_FALLBACK');
  });

  it('reproduces the exact historical v1 semantic-program digest', () => {
    const program = compileLegacyContextRetentionProgramV1({
      id: 'anvil.context-retention.v1',
      version: '1.0.0',
      digest: digest('a'),
    });

    expect(program.schema).toBe('anvil.registered-semantic-program.v1');
    expect(program.id).toBe('anvil.context-retention.v1');
    expect(program.version).toBe('1.0.0');
    expect(program.observationABIVersion).toBe('anvil.semantic-observation-abi.v1');
    expect(program.predicates.map((predicate) => predicate.id)).toEqual(
      LEGACY_MAPPED_OBSERVATION_AXES_V1,
    );
    expect(program.programDigest).toBe(
      'sha256:d3dcfc9fee03e658745b1adfb69aed0801e889828861aa19729862212d30e6e1',
    );
  });

  it('never treats legacy modeled recoverable as mechanical recovery authority', () => {
    const tampered = {
      ...legacyEnvelope,
      predicates: {
        ...legacyEnvelope.predicates,
        recoverable: 2,
      },
    };

    expect(
      validateLegacySemanticObservationEnvelopeV1(expectedLane, tampered).ok,
    ).toBe(false);
    expect(detectSemanticObservationABIVersion({
      ...legacyEnvelope,
      schema: 'anvil.semantic-observation-abi.v3',
    })).toBe(null);
  });
});
