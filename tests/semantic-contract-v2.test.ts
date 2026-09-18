import { describe, expect, it } from 'vitest';
import {
  MODELED_SEMANTIC_AXES_V2,
  compileContextRetentionProgramV2,
  reassembleSemanticObservationsV2,
} from '../src/lab/semantic-contract-v2.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

describe('Semantic Fabric V2 modeled observation contract', () => {
  it('models exactly four semantic predicates and excludes recoverability', () => {
    expect(MODELED_SEMANTIC_AXES_V2).toEqual([
      'evidence_sufficient',
      'still_needed',
      'full_content_needed',
      'unresolved_evidence',
    ]);
    expect(MODELED_SEMANTIC_AXES_V2).not.toContain('recoverable');

    const program = compileContextRetentionProgramV2({
      id: 'anvil.context-retention.v2',
      version: '2.0.0',
      digest: d('a'),
    });
    expect(program.observationABIVersion).toBe('anvil.semantic-observation-abi.v2');
    expect(program.predicates.map((x) => x.id)).toEqual(MODELED_SEMANTIC_AXES_V2);
    expect(program.predicates[0].requiresEvidenceSufficient).toBe(false);
    expect(program.predicates.slice(1).every((x) => x.requiresEvidenceSufficient)).toBe(true);
  });

  it('strictly reassembles the four-axis response and rejects semantic recoverability', () => {
    const good = {
      schema: 'anvil.semantic-decision-response.v2',
      request_id: 'req-v2',
      observations: [{
        candidate_id: 'cand-a',
        evidence_sufficient: { noul: 0.9 },
        still_needed: { noul: 0.8 },
        full_content_needed: { noul: 0.2 },
        unresolved_evidence: { noul: 0.1 },
      }],
    };
    expect(reassembleSemanticObservationsV2('req-v2', ['cand-a'], good).kind)
      .toBe('OBSERVATIONS');

    const contaminated = {
      ...good,
      observations: [{
        ...good.observations[0],
        recoverable: { noul: 1 },
      }],
    };
    expect(reassembleSemanticObservationsV2('req-v2', ['cand-a'], contaminated))
      .toMatchObject({ kind: 'PRISTINE_FALLBACK', code: 'malformed_observation' });
  });

  it('binds the semantic program identity into the v2 request contract', () => {
    const program = compileContextRetentionProgramV2({
      id: 'anvil.context-retention.v2',
      version: '2.0.0',
      digest: d('a'),
    });
    expect(program.programDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(program.programDigest).not.toBe(program.decisionContract.digest);
  });
});
