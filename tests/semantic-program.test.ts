import { describe, expect, it } from 'vitest';
import { compileContextRetentionProgram } from '../src/lab/semantic-program.js';

const digest = (c: string) => 'sha256:' + c.repeat(64);

describe('RegisteredSemanticProgram compiler', () => {
  it('freezes the five context-retention predicates in canonical order', () => {
    const program = compileContextRetentionProgram({
      id: 'anvil.context-retention.v1',
      version: '0.1.0',
      digest: digest('a'),
    });

    expect(program.predicates.map((p) => p.id)).toEqual([
      'evidence_sufficient',
      'still_needed',
      'full_content_needed',
      'unresolved_evidence',
      'recoverable',
    ]);
    expect(program.predicates[0].requiresEvidenceSufficient).toBe(false);
    expect(program.predicates.slice(1).every((p) => p.requiresEvidenceSufficient)).toBe(true);
  });

  it('produces a stable compiled-program digest bound to the source contract', () => {
    const a = compileContextRetentionProgram({
      id: 'anvil.context-retention.v1',
      version: '0.1.0',
      digest: digest('a'),
    });
    const b = compileContextRetentionProgram({
      id: 'anvil.context-retention.v1',
      version: '0.1.0',
      digest: digest('b'),
    });

    expect(a.programDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(compileContextRetentionProgram(a.decisionContract).programDigest).toBe(a.programDigest);
    expect(b.programDigest).not.toBe(a.programDigest);
  });
});
