import type {
  HardRootInput,
  HardRootResult,
  MappedHardRoots,
} from './types.js';

type SourceLine = {
  text: string;
  raw: string;
};

function linesWithRaw(source: string): SourceLine[] {
  if (source.length === 0) return [];
  const lines: SourceLine[] = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '\n') continue;
    lines.push({
      text: source.slice(start, index),
      raw: source.slice(start, index + 1),
    });
    start = index + 1;
  }
  if (start < source.length) {
    lines.push({
      text: source.slice(start),
      raw: source.slice(start),
    });
  }
  return lines;
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative integer`);
  }
  return value;
}

function hardRootByteCount(roots: MappedHardRoots): number {
  const canonical = JSON.stringify({
    exit_status: roots.exit_status,
    stderr: roots.stderr,
    first_lines: roots.first_lines,
    last_lines: roots.last_lines,
  });
  return Buffer.byteLength(canonical, 'utf8');
}

export function carveHardRoots(input: HardRootInput): HardRootResult {
  if (!Number.isInteger(input.exitStatus)) {
    throw new TypeError('exitStatus must be an integer');
  }
  const headLines = nonNegativeInteger(input.headLines, 'headLines');
  const tailLines = nonNegativeInteger(input.tailLines, 'tailLines');
  const budget = nonNegativeInteger(input.presentationBudgetBytes, 'presentationBudgetBytes');

  const stdoutLines = linesWithRaw(input.stdout);
  const stderrLines = linesWithRaw(input.stderr);

  const retained = new Set<number>();
  const firstCount = Math.min(headLines, stdoutLines.length);
  for (let index = 0; index < firstCount; index += 1) retained.add(index);

  const tailStart = Math.max(0, stdoutLines.length - tailLines);
  for (let index = tailStart; index < stdoutLines.length; index += 1) retained.add(index);

  const firstIndexes = Array.from({ length: firstCount }, (_, index) => index);
  const firstIndexSet = new Set(firstIndexes);
  const lastIndexes: number[] = [];
  for (let index = tailStart; index < stdoutLines.length; index += 1) {
    if (!firstIndexSet.has(index)) lastIndexes.push(index);
  }

  const hardRoots: MappedHardRoots = {
    exit_status: input.exitStatus,
    stderr: stderrLines.map((line) => line.text),
    first_lines: firstIndexes.map((index) => stdoutLines[index]!.text),
    last_lines: lastIndexes.map((index) => stdoutLines[index]!.text),
  };

  const hardRootBytes = hardRootByteCount(hardRoots);
  if (hardRootBytes > budget) {
    return {
      kind: 'PRISTINE',
      reason: 'hard_roots_exceed_budget',
      exitStatus: input.exitStatus,
      stdout: input.stdout,
      stderr: input.stderr,
      hardRootBytes,
    };
  }

  let omittedBytes = 0;
  for (let index = 0; index < stdoutLines.length; index += 1) {
    if (!retained.has(index)) omittedBytes += Buffer.byteLength(stdoutLines[index]!.raw, 'utf8');
  }

  return {
    kind: 'ELIGIBLE',
    hardRoots,
    hardRootBytes,
    omitted_stdout_bytes: omittedBytes,
    retained_stdout_line_indexes: [...retained].sort((a, b) => a - b),
  };
}
