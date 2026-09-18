import { classifyReplay, evaluateReplay, type ReplayCosts } from './metrics.js';
import { runObservationOnlyArm } from './observation-arm.js';
import { runDeterministicArm, runPristineArm, type ReplayRun, type ReplayTrace } from './replay.js';
import type { InMemoryCAS } from './recovery.js';
import { runUpstreamComparator, type UpstreamRetentionObserver } from './upstream-arm.js';

const digest = (char: string) => 'sha256:' + char.repeat(64);

export interface DownstreamTokenSample {
  pristine: number;
  arm: number;
  recovery?: number;
}

export interface ReplayMatrixDependencies {
  cas: InMemoryCAS;
  upstreamObserver: UpstreamRetentionObserver;
  observationProvider: (request: any) => Promise<unknown> | unknown;
  downstreamTokens?: (
    trace: ReplayTrace,
    arm: ReplayArm,
    run: ReplayRun,
  ) => DownstreamTokenSample | undefined;
}

export type ReplayArm = 'A' | 'B' | 'C' | 'D';

type ArmAggregate = {
  criticalEvidenceFalseEvictions: number;
  criticalEvidenceOpportunities: number;
  falseEvictionRate: number;
  recoveryNeeds: number;
  recoveryAttempts: number;
  exactRecoverySuccesses: number;
  exactRecoveryFailures: number;
  exactRecoverySuccessRate: number;
  abstentions: number;
  abstentionRate: number;
  pristineFallbacks: number;
  pristineFallbackRate: number;
  semanticProviderInputTokens: number;
  semanticProviderOutputTokens: number;
  semanticCostTokens: number;
  grossContextTokensSaved?: number;
  recoveryCostTokens?: number;
  netTokenSavings?: number;
  jevEfficiencyRatio?: number;
  latencyMsTotal: number;
  latencyMsMean: number;
  sourceBytes: number;
  visibleBytes: number;
  receiptCount: number;
  classification: 'PASS' | 'ARCHITECTURAL_FAILURE' | 'UNSCORED';
};

export interface ReplayMatrixReport {
  traceCount: number;
  candidateCount: number;
  arms: Record<ReplayArm, ArmAggregate>;
}

export interface RehydrationMeasurement {
  recoveryAttempts: number;
  exactRecoverySuccesses: number;
  exactRecoveryFailures: number;
}

export function measureExactRehydration(
  trace: ReplayTrace,
  run: ReplayRun,
  cas: InMemoryCAS,
): RehydrationMeasurement {
  const candidatesByID = new Map(
    trace.candidates.map((candidate) => [candidate.candidate_id, candidate]),
  );
  let recoveryAttempts = 0;
  let exactRecoverySuccesses = 0;
  let exactRecoveryFailures = 0;
  for (const presentation of run.presentations) {
    if (!presentation.recovery_required) continue;
    recoveryAttempts += 1;
    const candidate = candidatesByID.get(presentation.candidate_id);
    const ok = candidate !== undefined && cas.verifyTool(
      candidate.recovery,
      candidate.stdout,
      candidate.stderr,
      candidate.exit_status,
    ).ok;
    if (ok) {
      exactRecoverySuccesses += 1;
    } else {
      exactRecoveryFailures += 1;
    }
  }
  return { recoveryAttempts, exactRecoverySuccesses, exactRecoveryFailures };
}

function emptyAggregate(): ArmAggregate {
  return {
    criticalEvidenceFalseEvictions: 0,
    criticalEvidenceOpportunities: 0,
    falseEvictionRate: 0,
    recoveryNeeds: 0,
    recoveryAttempts: 0,
    exactRecoverySuccesses: 0,
    exactRecoveryFailures: 0,
    exactRecoverySuccessRate: 0,
    abstentions: 0,
    abstentionRate: 0,
    pristineFallbacks: 0,
    pristineFallbackRate: 0,
    semanticProviderInputTokens: 0,
    semanticProviderOutputTokens: 0,
    semanticCostTokens: 0,
    latencyMsTotal: 0,
    latencyMsMean: 0,
    sourceBytes: 0,
    visibleBytes: 0,
    receiptCount: 0,
    classification: 'UNSCORED',
  };
}

function sourceBytes(trace: ReplayTrace): number {
  return trace.candidates.reduce((total, candidate) => {
    const pristine = [candidate.stdout, candidate.stderr]
      .filter((value) => value.length > 0)
      .join('\n');
    return total + Buffer.byteLength(pristine, 'utf8');
  }, 0);
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
  const totals: Record<ReplayArm, ArmAggregate> = {
    A: emptyAggregate(),
    B: emptyAggregate(),
    C: emptyAggregate(),
    D: emptyAggregate(),
  };
  const economicsMeasured: Record<ReplayArm, number> = { A: 0, B: 0, C: 0, D: 0 };
  const grossSaved: Record<ReplayArm, number> = { A: 0, B: 0, C: 0, D: 0 };
  const recoveryCost: Record<ReplayArm, number> = { A: 0, B: 0, C: 0, D: 0 };
  const latencySamples: Record<ReplayArm, number> = { A: 0, B: 0, C: 0, D: 0 };
  const traceCandidates: Record<ReplayArm, number> = { A: 0, B: 0, C: 0, D: 0 };

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

  let candidateCount = 0;

  for (const trace of corpus) {
    candidateCount += trace.candidates.length;
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

    const receipt = observationRun.receipts[0];
    const semanticInput = receipt?.provider_usage.input_tokens ?? undefined;
    const semanticOutput = receipt?.provider_usage.output_tokens ?? undefined;

    const traceSourceBytes = sourceBytes(trace);
    for (const arm of ['A', 'B', 'C', 'D'] as const) {
      const run = runs[arm];
      const sample = dependencies.downstreamTokens?.(trace, arm, run);
      const costs: ReplayCosts = {
        pristineDownstreamTokens: sample?.pristine,
        armDownstreamTokensBeforeRehydration: sample?.arm,
        recoveryTokens: sample?.recovery,
        semanticProviderInputTokens: arm === 'D' ? semanticInput : undefined,
        semanticProviderOutputTokens: arm === 'D' ? semanticOutput : undefined,
      };
      const metrics = evaluateReplay(trace, run, costs);
      const aggregate = totals[arm];

      aggregate.criticalEvidenceFalseEvictions += metrics.criticalEvidenceFalseEvictions;
      aggregate.criticalEvidenceOpportunities += metrics.criticalEvidenceOpportunities;
      aggregate.recoveryNeeds += metrics.recoveryNeeds;
      aggregate.sourceBytes += traceSourceBytes;
      aggregate.visibleBytes += visibleBytes(run);
      traceCandidates[arm] += trace.candidates.length;

      const rehydration = measureExactRehydration(trace, run, dependencies.cas);
      aggregate.recoveryAttempts += rehydration.recoveryAttempts;
      aggregate.exactRecoverySuccesses += rehydration.exactRecoverySuccesses;
      aggregate.exactRecoveryFailures += rehydration.exactRecoveryFailures;

      aggregate.abstentions += run.presentations.filter(
        (presentation) => presentation.disposition === 'ABSTAIN',
      ).length;

      if (arm === 'D') {
        aggregate.semanticProviderInputTokens += semanticInput ?? 0;
        aggregate.semanticProviderOutputTokens += semanticOutput ?? 0;
      }
      aggregate.semanticCostTokens += metrics.semanticCostTokens;

      if (metrics.grossContextTokensSaved !== undefined) {
        economicsMeasured[arm] += 1;
        grossSaved[arm] += metrics.grossContextTokensSaved;
        recoveryCost[arm] += metrics.recoveryCostTokens;
      }

      if (arm === 'D' && receipt !== undefined) {
        if (receipt.pristine_fallback) aggregate.pristineFallbacks += 1;
        if (receipt.latency_ms !== null) {
          aggregate.latencyMsTotal += receipt.latency_ms;
          latencySamples[arm] += 1;
        }
      }
    }
    totals.D.receiptCount += observationRun.receipts.length;
  }

  for (const arm of ['A', 'B', 'C', 'D'] as const) {
    const aggregate = totals[arm];
    aggregate.falseEvictionRate = aggregate.criticalEvidenceOpportunities === 0
      ? 0
      : aggregate.criticalEvidenceFalseEvictions / aggregate.criticalEvidenceOpportunities;
    aggregate.exactRecoverySuccessRate = aggregate.recoveryAttempts === 0
      ? 0
      : aggregate.exactRecoverySuccesses / aggregate.recoveryAttempts;
    aggregate.abstentionRate = traceCandidates[arm] === 0
      ? 0
      : aggregate.abstentions / traceCandidates[arm];
    aggregate.pristineFallbackRate = corpus.length === 0
      ? 0
      : aggregate.pristineFallbacks / corpus.length;
    aggregate.latencyMsMean = latencySamples[arm] === 0
      ? 0
      : aggregate.latencyMsTotal / latencySamples[arm];

    if (economicsMeasured[arm] === corpus.length && corpus.length > 0) {
      aggregate.grossContextTokensSaved = grossSaved[arm];
      aggregate.recoveryCostTokens = recoveryCost[arm];
      aggregate.netTokenSavings =
        grossSaved[arm] - aggregate.semanticCostTokens - recoveryCost[arm];
      const denominator = aggregate.semanticCostTokens + recoveryCost[arm];
      if (denominator > 0) {
        aggregate.jevEfficiencyRatio = grossSaved[arm] / Math.max(1, denominator);
      }
    }

    if (aggregate.semanticCostTokens === 0 || aggregate.jevEfficiencyRatio !== undefined) {
      aggregate.classification = classifyReplay({
        criticalEvidenceFalseEvictions: aggregate.criticalEvidenceFalseEvictions,
        semanticCostTokens: aggregate.semanticCostTokens,
        jevEfficiencyRatio: aggregate.jevEfficiencyRatio,
      });
    } else {
      aggregate.classification = 'UNSCORED';
    }
  }

  return { traceCount: corpus.length, candidateCount, arms: totals };
}
