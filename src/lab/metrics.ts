import type { ReplayRun, ReplayTrace } from './replay.js';

export interface ReplayCosts {
  pristineDownstreamTokens?: number;
  armDownstreamTokensBeforeRehydration?: number;
  semanticProviderInputTokens?: number;
  semanticProviderOutputTokens?: number;
  recoveryTokens?: number;
}

export interface ReplayMetrics {
  criticalEvidenceFalseEvictions: number;
  criticalEvidenceOpportunities: number;
  falseEvictionRate: number;
  recoveryNeeds: number;
  grossContextTokensSaved?: number;
  semanticCostTokens: number;
  recoveryCostTokens: number;
  netTokenSavings?: number;
  jevEfficiencyRatio?: number;
}

export function evaluateReplay(
  trace: ReplayTrace,
  run: ReplayRun,
  costs: ReplayCosts = {},
): ReplayMetrics {
  let falseEvictions = 0;
  let recoveryNeeds = 0;
  let opportunities = 0;

  for (const candidate of trace.candidates) {
    opportunities += candidate.critical_evidence.length;
    const presentation = run.presentations.find((item) => item.candidate_id === candidate.candidate_id);
    const visible = presentation?.visible_text ?? '';
    if (presentation?.recovery_required) recoveryNeeds += 1;
    for (const critical of candidate.critical_evidence) {
      if (!visible.includes(critical)) falseEvictions += 1;
    }
  }

  const semanticCostTokens =
    (costs.semanticProviderInputTokens ?? 0) + (costs.semanticProviderOutputTokens ?? 0);
  const recoveryCostTokens = costs.recoveryTokens ?? 0;

  let grossContextTokensSaved: number | undefined;
  let netTokenSavings: number | undefined;
  let jevEfficiencyRatio: number | undefined;
  if (
    costs.pristineDownstreamTokens !== undefined &&
    costs.armDownstreamTokensBeforeRehydration !== undefined
  ) {
    grossContextTokensSaved =
      costs.pristineDownstreamTokens - costs.armDownstreamTokensBeforeRehydration;
    netTokenSavings = grossContextTokensSaved - semanticCostTokens - recoveryCostTokens;
    if (semanticCostTokens + recoveryCostTokens > 0) {
      jevEfficiencyRatio =
        grossContextTokensSaved / Math.max(1, semanticCostTokens + recoveryCostTokens);
    }
  }

  return {
    criticalEvidenceFalseEvictions: falseEvictions,
    criticalEvidenceOpportunities: opportunities,
    falseEvictionRate: opportunities === 0 ? 0 : falseEvictions / opportunities,
    recoveryNeeds,
    grossContextTokensSaved,
    semanticCostTokens,
    recoveryCostTokens,
    netTokenSavings,
    jevEfficiencyRatio,
  };
}

export function classifyReplay(
  metrics: Pick<ReplayMetrics, 'criticalEvidenceFalseEvictions' | 'semanticCostTokens' | 'jevEfficiencyRatio'>,
): 'PASS' | 'ARCHITECTURAL_FAILURE' | 'UNSCORED' {
  if (metrics.criticalEvidenceFalseEvictions > 0) return 'ARCHITECTURAL_FAILURE';
  if (metrics.semanticCostTokens > 0) {
    if ((metrics.jevEfficiencyRatio ?? 0) < 1) return 'ARCHITECTURAL_FAILURE';
    return 'PASS';
  }
  return 'UNSCORED';
}
