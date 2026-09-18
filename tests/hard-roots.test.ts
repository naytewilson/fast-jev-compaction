import { describe, expect, it } from 'vitest';
import * as library from '../src/index.js';

type AnyFn = (...args: any[]) => any;

function exportedFunction(name: string): AnyFn {
  const value = (library as Record<string, unknown>)[name];
  expect(typeof value).toBe('function');
  return value as AnyFn;
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    exitStatus: 7,
    stdout: ['line-1', 'line-2', 'line-3', 'line-4', 'line-5'].join('\n'),
    stderr: ['warning-a', 'warning-b'].join('\n'),
    headLines: 2,
    tailLines: 2,
    presentationBudgetBytes: 1_000_000,
    ...overrides,
  };
}

describe('deterministic hard-root carving', () => {
  it('retains exit status, every stderr line, and head/tail stdout roots', () => {
    const carve = exportedFunction('carveHardRoots');
    const result = carve(baseInput());
    expect(result.kind).toBe('ELIGIBLE');
    expect(result.hardRoots.exit_status).toBe(7);
    expect(result.hardRoots.stderr).toEqual(['warning-a', 'warning-b']);
    expect(result.hardRoots.first_lines).toEqual(['line-1', 'line-2']);
    expect(result.hardRoots.last_lines).toEqual(['line-4', 'line-5']);
    expect(result.omitted_stdout_bytes).toBeGreaterThan(0);
  });

  it('de-duplicates overlapping head and tail roots', () => {
    const carve = exportedFunction('carveHardRoots');
    const result = carve(
      baseInput({
        stdout: ['a', 'b', 'c'].join('\n'),
        headLines: 2,
        tailLines: 2,
      }),
    );
    expect(result.kind).toBe('ELIGIBLE');
    expect(result.hardRoots.first_lines).toEqual(['a', 'b']);
    expect(result.hardRoots.last_lines).toEqual(['c']);
  });

  it('reports deterministic hard-root byte counts', () => {
    const carve = exportedFunction('carveHardRoots');
    const first = carve(baseInput());
    const second = carve(baseInput());
    expect(first.hardRootBytes).toBe(second.hardRootBytes);
    expect(first.hardRootBytes).toBeGreaterThan(0);
  });

  it('accepts a budget exactly equal to the hard-root byte count', () => {
    const carve = exportedFunction('carveHardRoots');
    const measured = carve(baseInput());
    const exact = carve(baseInput({ presentationBudgetBytes: measured.hardRootBytes }));
    expect(exact.kind).toBe('ELIGIBLE');
    expect(exact.hardRootBytes).toBe(measured.hardRootBytes);
  });

  it('returns pristine one byte below the hard-root byte count without mutating roots', () => {
    const carve = exportedFunction('carveHardRoots');
    const original = baseInput();
    const measured = carve(original);
    const pristine = carve({
      ...original,
      presentationBudgetBytes: measured.hardRootBytes - 1,
    });
    expect(pristine).toMatchObject({
      kind: 'PRISTINE',
      reason: 'hard_roots_exceed_budget',
      exitStatus: original.exitStatus,
      stdout: original.stdout,
      stderr: original.stderr,
      hardRootBytes: measured.hardRootBytes,
    });
  });
});
