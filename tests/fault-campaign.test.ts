import { describe, expect, it } from 'vitest';
import { buildSyntheticFaultCampaign } from '../src/lab/fault-campaign.js';
import { evaluateDegradedTrial } from '../src/lab/degraded-trial.js';

describe('10K deterministic semantic fault campaign', () => {
  it('creates exactly 10,000 degraded opportunities plus one FULL baseline', () => {
    const campaign = buildSyntheticFaultCampaign(10_000);
    expect(campaign).toHaveLength(10_001);

    const degraded = campaign.filter((cycle) => !cycle.shouldHavePolicyAuthority);
    expect(degraded).toHaveLength(10_000);

    const scenarios = new Set(degraded.map((cycle) => cycle.scenario));
    expect(scenarios.size).toBe(15);
    expect(scenarios.has('FULL')).toBe(false);
  });

  it('suppresses all false authority in the safe synthetic campaign', () => {
    const result = evaluateDegradedTrial(buildSyntheticFaultCampaign(10_000));

    expect(result.falseAuthority.opportunities).toBe(10_000);
    expect(result.falseAuthority.leaks).toBe(0);
    expect(result.falseAuthority.fasr).toBe(1);
    expect(result.falseAuthority.approximateFarUpper95).toBeCloseTo(0.0003, 12);
    expect(result.fallbackCoverageRetention).toBe(1);
    expect(result.verdict).toBe('PASS_SYNTHETIC');
    expect(result.timingEvidence).toBe('synthetic');
  });

  it('marks every degraded cycle as conservative synthetic fallback with task continuity', () => {
    const degraded = buildSyntheticFaultCampaign(10_000)
      .filter((cycle) => !cycle.shouldHavePolicyAuthority);

    expect(degraded.every((cycle) => cycle.syntheticTiming)).toBe(true);
    expect(degraded.every((cycle) => cycle.fallbackActivated)).toBe(true);
    expect(degraded.every((cycle) => cycle.taskCompleted)).toBe(true);
    expect(degraded.every((cycle) => !cycle.policyTriggered)).toBe(true);
  });

  it('turns one false-authority mutation into an architectural failure', () => {
    const campaign = [...buildSyntheticFaultCampaign(10_000)];
    const index = campaign.findIndex((cycle) => !cycle.shouldHavePolicyAuthority);
    campaign[index] = { ...campaign[index], policyTriggered: true };

    const result = evaluateDegradedTrial(campaign);
    expect(result.falseAuthority.leaks).toBe(1);
    expect(result.verdict).toBe('ARCHITECTURAL_FAILURE');
  });
});
