import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeAxisIsolateV2,
  buildAxisIsolateManifestV2,
  type AxisIsolateObservationV2,
  type ParentAxisObservationV2,
} from '../src/lab/axis-isolate-diagnostic-v2.js';
import type { ModeledSemanticAxisV2 } from '../src/lab/semantic-contract-v2.js';

const parentDir = 'artifacts/axis-discrimination-battery';

function loadParent() {
  const sourceRows = readFileSync(
    `${parentDir}/noul-manifest-v2.jsonl`,
    'utf8',
  ).trim().split('\n').map((line) => JSON.parse(line));
  const anchorPlan = JSON.parse(
    readFileSync(`${parentDir}/anchor-plan-v2.json`, 'utf8'),
  );
  const parentObservations = readFileSync(
    `${parentDir}/v2-axis-observations.jsonl`,
    'utf8',
  ).trim().split('\n').map((line) => JSON.parse(line));
  return { sourceRows, anchorPlan, parentObservations };
}

function isolateObservations(
  manifest: ReturnType<typeof buildAxisIsolateManifestV2>,
  probability: (target: 0 | 1, axis: ModeledSemanticAxisV2) => number,
  mass: number,
): AxisIsolateObservationV2[] {
  return manifest.map((row, index) => ({
    schema: 'anvil.axis-isolate-observation.v2',
    requestId: row.requestId,
    candidateId: row.candidateId,
    candidateViewDigest: row.candidateViewDigest,
    providerProfileDigest: 'sha256:' + 'a'.repeat(64),
    axisSpecDigest: row.axisSpecDigest,
    axis: row.axis,
    probability: probability(row.target, row.axis),
    yesAbs: probability(row.target, row.axis) * mass,
    noAbs: (1 - probability(row.target, row.axis)) * mass,
    answerTokenMass: mass,
    promptDigest: 'sha256:' + String((index % 9) + 1).repeat(64),
    timingMs: 10,
  }));
}

describe('V2 first-slot axis isolate diagnostic', () => {
  it('selects exactly the 16 primary anchors with 2 positive and 2 negative rows per axis', () => {
    const { sourceRows, anchorPlan } = loadParent();
    const manifest = buildAxisIsolateManifestV2({
      sourceRows,
      anchors: anchorPlan.anchors,
    });

    expect(manifest).toHaveLength(16);
    expect(new Set(manifest.map((row) => row.candidateId)).size).toBe(16);
    for (const axis of [
      'evidence_sufficient',
      'still_needed',
      'full_content_needed',
      'unresolved_evidence',
    ] as const) {
      const rows = manifest.filter((row) => row.axis === axis);
      expect(rows).toHaveLength(4);
      expect(rows.filter((row) => row.target === 1)).toHaveLength(2);
      expect(rows.filter((row) => row.target === 0)).toHaveLength(2);
      for (const row of rows) {
        const source = sourceRows.find(
          (candidate: { candidateId: string }) =>
            candidate.candidateId === row.candidateId,
        );
        expect(row.prompt).toBe(source.prompts[axis]);
      }
    }
  });

  it('refuses semantic interpretation when isolated answer-token mass remains low', () => {
    const { sourceRows, anchorPlan, parentObservations } = loadParent();
    const manifest = buildAxisIsolateManifestV2({
      sourceRows,
      anchors: anchorPlan.anchors,
    });
    const report = analyzeAxisIsolateV2({
      manifest,
      observations: isolateObservations(
        manifest,
        (target) => target === 1 ? 0.9 : 0.1,
        0.1,
      ),
      parentObservations: parentObservations as ParentAxisObservationV2[],
    });

    expect(report.allRowsAnswerable).toBe(false);
    expect(report.decision).toBe('HARNESS_STILL_INVALID_LOW_ANSWER_MASS');
    expect(Object.values(report.axes).every(
      (axis) => axis.answerTokenMass.allAboveFloor === false,
    )).toBe(true);
  });

  it('separates repaired harness from persistent semantic failure', () => {
    const { sourceRows, anchorPlan, parentObservations } = loadParent();
    const manifest = buildAxisIsolateManifestV2({
      sourceRows,
      anchors: anchorPlan.anchors,
    });

    const repaired = analyzeAxisIsolateV2({
      manifest,
      observations: isolateObservations(
        manifest,
        (target) => target === 1 ? 0.9 : 0.1,
        0.95,
      ),
      parentObservations: parentObservations as ParentAxisObservationV2[],
    });
    expect(repaired.allRowsAnswerable).toBe(true);
    expect(repaired.decision).toBe('HARNESS_REPAIRED_AXES_DISCRIMINATE');
    expect(Object.values(repaired.axes).every(
      (axis) => axis.classification === 'ORDERING_GOOD_BIAS_ONLY',
    )).toBe(true);

    const persistent = analyzeAxisIsolateV2({
      manifest,
      observations: isolateObservations(
        manifest,
        (target, axis) =>
          axis === 'unresolved_evidence'
            ? (target === 1 ? 0.1 : 0.9)
            : (target === 1 ? 0.9 : 0.1),
        0.95,
      ),
      parentObservations: parentObservations as ParentAxisObservationV2[],
    });
    expect(persistent.allRowsAnswerable).toBe(true);
    expect(persistent.decision).toBe(
      'HARNESS_REPAIRED_SEMANTIC_FAILURE_PERSISTS',
    );
    expect(persistent.axes.unresolved_evidence.classification).toBe('INVERTED');
  });

  it('runs generator and analyzer CLIs against the committed parent evidence without changing authority', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jev-axis-isolate-'));
    try {
      const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      const generated = spawnSync(
        npx,
        ['tsx', 'tools/noul-axis-isolate-v2.ts', parentDir, dir],
        { cwd: process.cwd(), encoding: 'utf8' },
      );
      expect(generated.status).toBe(0);
      expect(generated.stdout).toContain('rows=16');
      expect(generated.stdout).toContain('promotionAuthority=NONE');

      const manifest = readFileSync(
        join(dir, 'axis-isolate-manifest-v2.jsonl'),
        'utf8',
      ).trim().split('\n').map((line) => JSON.parse(line));
      const parentObservations = readFileSync(
        `${parentDir}/v2-axis-observations.jsonl`,
        'utf8',
      ).trim().split('\n').map((line) => JSON.parse(line));
      const identity = JSON.parse(
        readFileSync(join(dir, 'axis-isolate-identity-v2.json'), 'utf8'),
      );
      const observations = isolateObservations(
        manifest,
        (target) => target === 1 ? 0.9 : 0.1,
        0.95,
      ).map((row) => ({
        ...row,
        providerProfileDigest: identity.providerProfileDigest,
      }));
      const observationPath = join(dir, 'observations.jsonl');
      writeFileSync(
        observationPath,
        observations.map((row) => JSON.stringify(row)).join('\n') + '\n',
      );
      const parentPath = join(dir, 'parent.jsonl');
      writeFileSync(
        parentPath,
        parentObservations.map((row) => JSON.stringify(row)).join('\n') + '\n',
      );

      const analyzed = spawnSync(
        npx,
        ['tsx', 'tools/analyze-axis-isolate-v2.ts', dir, observationPath, parentPath],
        { cwd: process.cwd(), encoding: 'utf8' },
      );
      expect(analyzed.status).toBe(0);
      expect(analyzed.stdout).toContain(
        'decision=HARNESS_REPAIRED_AXES_DISCRIMINATE',
      );
      expect(analyzed.stdout).toContain('promotionAuthority=NONE');

      const report = JSON.parse(
        readFileSync(join(dir, 'axis-isolate-report-v2.json'), 'utf8'),
      );
      expect(report.nonAuthoritative).toBe(true);
      expect(report.promotionAuthority).toBe('NONE');
      expect(report.allRowsAnswerable).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('syntax-checks the local-only tokenizer and parser scripts in cloud CI', () => {
    for (const path of [
      'tools/tokenize-axis-isolate-v2.mjs',
      'tools/parse-axis-isolate-log-v2.mjs',
    ]) {
      const checked = spawnSync(process.execPath, ['--check', path], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });
      expect(checked.status, checked.stderr).toBe(0);
    }
  });
});
