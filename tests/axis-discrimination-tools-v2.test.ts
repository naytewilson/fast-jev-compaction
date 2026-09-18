import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { neoLfmIdentityV2 } from '../src/lab/noul-file-provider-v2.js';
import { MODELED_SEMANTIC_AXES_V2 } from '../src/lab/semantic-contract-v2.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

function runTsx(args: string[]): { stdout: string; stderr: string } {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(npx, ['tsx', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, npm_config_update_notifier: 'false' },
  });
  if (result.status !== 0) {
    throw new Error(
      `tsx command failed status=${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

describe('V2 axis-discrimination cloud toolchain', () => {
  it('generates the 16-anchor campaign and analyzes perfectly ordered bound records end-to-end', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jev-axis-v2-'));
    try {
      const built = runTsx([
        'tools/noul-axis-discrimination-v2.ts',
        dir,
      ]);
      expect(built.stdout).toContain('manifest rows: 16');
      expect(built.stdout).toContain('labels: 64');
      expect(built.stdout).toContain('promotionAuthority=NONE');

      const manifest = readFileSync(
        join(dir, 'noul-manifest-v2.jsonl'),
        'utf8',
      ).trim().split('\n').map((line) => JSON.parse(line));
      const labels = JSON.parse(
        readFileSync(join(dir, 'labels-v2.json'), 'utf8'),
      );
      const identity = JSON.parse(
        readFileSync(join(dir, 'campaign-identity-v2.json'), 'utf8'),
      );
      expect(manifest).toHaveLength(16);
      expect(labels).toHaveLength(64);

      const inventory = {
        packageDigest: d('1'),
        tokenizerDigest: d('2'),
        weightsDigest: d('3'),
        quantization: 'int4',
        releaseId: 'axis-cloud-fixture',
        backend: 'coreml-ane',
        runtimeVersion: 'fixture-runtime-v1',
        compilerDigest: d('4'),
        contextWindow: 512,
        samplingDigest: d('5'),
        hardwareSemanticsClass: 'fixture-only',
      };
      const neo = neoLfmIdentityV2(inventory);
      const inventoryPath = join(dir, 'neo-inventory.json');
      writeFileSync(
        inventoryPath,
        JSON.stringify(inventory, null, 2) + '\n',
      );

      const targetBySourceAxis = new Map<string, 0 | 1>(
        labels.map((label: {
          sourceDigest: string;
          predicateId: string;
          target: 0 | 1;
        }) => [
          `${label.sourceDigest}:${label.predicateId}`,
          label.target,
        ]),
      );

      const records = manifest.map((row: {
        requestId: string;
        candidateId: string;
        candidateViewDigest: string;
        sourceDigest: string;
        axisSpecDigest: string;
      }) => {
        const axisProbabilities = Object.fromEntries(
          MODELED_SEMANTIC_AXES_V2.map((axis) => {
            const target = targetBySourceAxis.get(
              `${row.sourceDigest}:${axis}`,
            );
            if (target === undefined) {
              throw new Error(
                `missing fixture target for ${row.candidateId}:${axis}`,
              );
            }
            return [axis, target === 1 ? 0.9 : 0.1];
          }),
        );
        const promptDigests = Object.fromEntries(
          MODELED_SEMANTIC_AXES_V2.map((axis) => [axis, d('e')]),
        );
        const telemetry = Object.fromEntries(
          MODELED_SEMANTIC_AXES_V2.map((axis) => {
            const p = axisProbabilities[axis] as number;
            return [axis, {
              probs: { '12447': p, '4547': 1 - p },
              abs: { '12447': p / 2, '4547': (1 - p) / 2 },
            }];
          }),
        );
        return {
          schema: 'anvil.noul-observation.v2',
          candidateViewDigest: row.candidateViewDigest,
          requestId: row.requestId,
          candidateId: row.candidateId,
          providerProfileDigest: neo.profile.providerProfileDigest,
          axisSpecDigest: row.axisSpecDigest,
          axisProbabilities,
          promptDigests,
          probeMode: 'conditional',
          yesTokenIds: [11683, 12447, 18171, 17550],
          noTokenIds: [2243, 4547, 794, 2752],
          telemetry,
          timingsMs: { prefill: 10, decode: 0 },
        };
      });
      const recordsPath = join(dir, 'observations-v2.jsonl');
      writeFileSync(
        recordsPath,
        records.map((record) => JSON.stringify(record)).join('\n') + '\n',
      );

      const analyzed = runTsx([
        'tools/analyze-axis-discrimination-v2.ts',
        dir,
        recordsPath,
        inventoryPath,
      ]);
      expect(analyzed.stdout).toContain(
        'fullExpansionJustified=true',
      );
      expect(analyzed.stdout).toContain(
        'decision=PROCEED_TO_CALIBRATION_THEN_26_ROW_EXPANSION',
      );
      expect(analyzed.stdout).toContain('promotionAuthority=NONE');

      const report = JSON.parse(
        readFileSync(
          join(dir, 'axis-discrimination-report-v2.json'),
          'utf8',
        ),
      );
      expect(report.candidateCount).toBe(16);
      expect(report.predictionCount).toBe(64);
      expect(report.axisSpecDigest).toBe(identity.axisSpecDigest);
      expect(report.promotionAuthority).toBe('NONE');
      expect(report.nonAuthoritative).toBe(true);
      expect(report.fullExpansionJustified).toBe(true);
      expect(report.semanticsRepairAxes).toEqual([]);
      expect(report.providerFitBlockerAxes).toEqual([]);
      for (const axis of MODELED_SEMANTIC_AXES_V2) {
        expect(report.axes[axis].classificationCode).toBe('A');
        expect(report.axes[axis].pairwiseOrderingRate).toBe(1);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
