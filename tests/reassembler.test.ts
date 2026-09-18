import { describe, expect, it } from 'vitest';
import * as library from '../src/index.js';

type AnyFn = (...args: any[]) => any;

function exportedFunction(name: string): AnyFn {
  const value = (library as Record<string, unknown>)[name];
  expect(typeof value).toBe('function');
  return value as AnyFn;
}

const axis = (noul: number) => ({ noul });

function observation(candidate_id: string, noul = 0.5) {
  return {
    candidate_id,
    evidence_sufficient: axis(noul),
    still_needed: axis(noul),
    full_content_needed: axis(noul),
    unresolved_evidence: axis(noul),
    recoverable: axis(noul),
  };
}

function response(observations: unknown[], request_id = 'mdr-0001') {
  return {
    schema: 'anvil.mapped-decision-response.v0',
    request_id,
    observations,
  };
}

const candidateIDs = ['cand-0001', 'cand-0002'] as const;

describe('strict mapped observation reassembly', () => {
  it('accepts a complete one-to-one observation set', () => {
    const reassemble = exportedFunction('reassembleMappedObservations');
    const result = reassemble(
      'mdr-0001',
      candidateIDs,
      response([observation('cand-0001', 0.1), observation('cand-0002', 0.9)]),
    );
    expect(result.kind).toBe('OBSERVATIONS');
    expect(result.observations.map((item: any) => item.candidate_id)).toEqual(candidateIDs);
  });

  it('accepts a complete permutation but restores canonical input order', () => {
    const reassemble = exportedFunction('reassembleMappedObservations');
    const result = reassemble(
      'mdr-0001',
      candidateIDs,
      response([observation('cand-0002', 0.9), observation('cand-0001', 0.1)]),
    );
    expect(result.kind).toBe('OBSERVATIONS');
    expect(result.observations.map((item: any) => item.candidate_id)).toEqual(candidateIDs);
  });

  it('fails closed on returned cardinality mismatch', () => {
    const reassemble = exportedFunction('reassembleMappedObservations');
    expect(reassemble('mdr-0001', candidateIDs, response([observation('cand-0001')]))).toMatchObject({
      kind: 'PRISTINE_FALLBACK',
    });
  });

  it('fails closed on key-set mismatch', () => {
    const reassemble = exportedFunction('reassembleMappedObservations');
    expect(
      reassemble(
        'mdr-0001',
        candidateIDs,
        response([observation('cand-0001'), observation('cand-9999')]),
      ),
    ).toMatchObject({ kind: 'PRISTINE_FALLBACK' });
  });

  it('fails closed on duplicate candidate ids', () => {
    const reassemble = exportedFunction('reassembleMappedObservations');
    expect(
      reassemble(
        'mdr-0001',
        candidateIDs,
        response([observation('cand-0001'), observation('cand-0001')]),
      ),
    ).toMatchObject({ kind: 'PRISTINE_FALLBACK' });
  });

  it('fails closed on an unknown candidate id', () => {
    const reassemble = exportedFunction('reassembleMappedObservations');
    expect(
      reassemble(
        'mdr-0001',
        candidateIDs,
        response([observation('cand-0001'), observation('cand-0003')]),
      ),
    ).toMatchObject({ kind: 'PRISTINE_FALLBACK' });
  });

  for (const field of [
    'evidence_sufficient',
    'still_needed',
    'full_content_needed',
    'unresolved_evidence',
    'recoverable',
  ]) {
    it(`fails closed when ${field} is missing`, () => {
      const reassemble = exportedFunction('reassembleMappedObservations');
      const damaged = observation('cand-0001') as any;
      delete damaged[field];
      expect(
        reassemble('mdr-0001', candidateIDs, response([damaged, observation('cand-0002')])),
      ).toMatchObject({ kind: 'PRISTINE_FALLBACK' });
    });
  }

  for (const [label, value] of [
    ['NaN', Number.NaN],
    ['positive Infinity', Number.POSITIVE_INFINITY],
    ['below zero', -0.001],
    ['above one', 1.001],
  ] as const) {
    it(`fails closed on probability ${label}`, () => {
      const reassemble = exportedFunction('reassembleMappedObservations');
      const damaged = observation('cand-0001') as any;
      damaged.still_needed.noul = value;
      expect(
        reassemble('mdr-0001', candidateIDs, response([damaged, observation('cand-0002')])),
      ).toMatchObject({ kind: 'PRISTINE_FALLBACK' });
    });
  }

  it('fails closed on request id mismatch', () => {
    const reassemble = exportedFunction('reassembleMappedObservations');
    expect(
      reassemble(
        'mdr-0001',
        candidateIDs,
        response([observation('cand-0001'), observation('cand-0002')], 'mdr-other'),
      ),
    ).toMatchObject({ kind: 'PRISTINE_FALLBACK' });
  });
});
