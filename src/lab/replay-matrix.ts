import { classifyReplay, evaluateReplay } from './metrics.js';
import { runObservationOnlyArm } from './observation-arm.js';
import { runDeterministicArm, runPristineArm, type ReplayRun, type ReplayTrace } from './replay.js';
import type { InMemoryCAS } from './recovery.js';
import { runUpstreamComparator, type UpstreamRetentionObserver } from './upstream-arm.js';

const digest = (char: string) => 'sha256:' + char.repeat(64);

export interface ReplayMatrixDependencies {
  cas: InMemoryCAS;
  upstreamObserver: UpstreamRetentionObserver;
  observationProvider: (request: any) => Promise<unknown> | unknown;
}

type ArmAggregate = {
  criticalEvidenceFalseEvictions: number;
  recoveryNeeds: number;
  sourceBytes: number;
  visibleBytes: number;
  receiptCount: number;
  classification: 'PASS' | 'ARCHITECTURAL_FAILURE' | 'UNSCORED';
};

export interface ReplayMatrixReport {
  traceCount: number;
  arms: Record<'A' | 'B' | 'C' | 'D', ArmAggregate>;
}

function emptyAggregate(): ArmAggregate {
  return {
    criticalEvidenceFalseEvictions: 0,
    recoveryNeeds: 0,
    sourceBytes: 0,
    visibleBytes: 0,
    receiptCount: 0,
    classification: 'UNSCORED',
  };
}

function sourceBytes(trace: ReplayTrace): number {
  return trace.candidates.reduce(
    (total, candidate) =>
      total +
      Buffer.byteLength(candidate.stdout, 'utf8') +
      Buffer.byteLength(candidate.stderr, 'utf8'),
    0,
  );
}

function visibleBytes(run: ReplayRun): number {
  return run.presentations.reduce(
    (total, presentation) => total + Buffer.byteLength(presentation.visible_text, 'utf8'),
    0,
  );
}

export async function runReplayMatrix(
  corpus: ReplayTrace[],
  dependencies: ReplayMatrixDependencies,
): Promise<ReplayMatrixReport> {
  const totals: Record<'A' | 'B' | 'C' | 'D', ArmAggregate> = {
    A: emptyAggregate(),
    B: emptyAggregate(),
    C: emptyAggregate(),
    D: emptyAggregate(),
  };

  const profiles = {
    decision_contract: { id: 'anvil.context-retention.v1', version: '0.1.0', digest: digest('a') },
    execution_profile: { id: 'offline-fixture', version: '0.1.0', digest: digest('b') },
    calibration_profile: { id: 'offline-conservative', version: '0.1.0', digest: digest('c') },
    policy_profile: { id: 'offline-shadow', version: '0.1.0', digest: digest('d') },
  };
  const thresholds = {
    evidenceSufficientFloor: 0.8,
    keepFull: 0.8,
    retain: 0.5,
  };

  for (const trace of corpus) {
    const observationRun = await runObservationOnlyArm(
      trace,
      dependencies.cas,
      profiles,
      thresholds,
      dependencies.observationProvider,
    );
    const runs = {
      A: runPristineArm(trace, dependencies.cas),
      B: runDeterministicArm(trace, dependencies.cas),
      C: await runUpstreamComparator(trace, dependencies.cas, dependencies.upstreamObserver, 0.5),
      D: observationRun,
    };

    const traceSourceBytes = sourceBytes(trace);
    for (const arm of ['A', 'B', 'C', 'D'] as const) {
      const metrics = evaluateReplay(trace, runs[arm]);
      totals[arm].criticalEvidenceFalseEvictions += metrics.criticalEvidenceFalseEvictions;
      totals[arm].recoveryNeeds += metrics.recoveryNeeds;
      totals[arm].sourceBytes += traceSourceBytes;
      totals[arm].visibleBytes += visibleBytes(runs[arm]);
    }
    totals.D.receiptCount += observationRun.receipts.length;
  }

  for (const arm of ['A', 'B', 'C', 'D'] as const) {
    totals[arm].classification = classifyReplay({
      criticalEvidenceFalseEvictions: totals[arm].criticalEvidenceFalseEvictions,
      semanticCostTokens: 0,
    });
  }

  return { traceCount: corpus.length, arms: totals };
}
