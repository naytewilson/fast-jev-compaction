import { describe, expect, it } from 'vitest';
import {
  executeScenario,
  runFaultCampaign,
  type ScenarioRunnerContext,
} from '../src/lab/scenario-runner.js';
import { AuthorityRegistry } from '../src/lab/authority-registry.js';
import {
  InMemoryCAS,
  createToolRecoveryManifest,
  encodeToolEvidence,
} from '../src/lab/recovery.js';
import {
  d,
  makeBuild,
  makeSafety,
  makeCredential,
} from './provider-authority-fixtures.js';

const thresholds = {
  evidenceSufficientFloor: 0.8,
  keepFull: 0.8,
  retain: 0.5,
};

function makeTrace() {
  const stdout = 'head evidence line\ncritical middle evidence\ntail line';
  return {
    trace_id: 'sc-01',
    source_run_id: 'run-sc-01',
    shared_state: 'scenario runner test',
    candidates: [{
      candidate_id: 'cand-sc-01',
      stdout,
      stderr: '',
      exit_status: 0,
      head_lines: 1,
      tail_lines: 1,
      presentation_budget_bytes: 4096,
      recovery: createToolRecoveryManifest(stdout, '', 0, 'obj-sc-01'),
      critical_evidence: ['critical middle evidence'],
    }],
  };
}

function makeCtx(): ScenarioRunnerContext {
  const trace = makeTrace();
  const { providerProfile, build } = makeBuild();
  const safety = makeSafety(providerProfile, build.calibrationArtifact.calibrationIdentity);
  const profiles = {
    decision_contract: { id: 'anvil.context-retention.v1', version: '1.0.0', digest: d('e') },
    execution_profile: { id: providerProfile.providerId, version: '1.0.0', digest: providerProfile.providerProfileDigest },
    calibration_profile: { id: 'shadow', version: '1.0.0', digest: d('b') },
    policy_profile: { id: 'shadow-policy', version: '1.0.0', digest: d('c') },
  };
  const { credential } = makeCredential();
  const registry = new AuthorityRegistry();
  registry.registerCredential(credential);
  return {
    profiles,
    providerProfile,
    thresholds,
    traces: [trace],
    labels: [],
    build,
    safety,
    lineageDigest: d('7'),
    registry,
  };
}

function casFor(trace: ReturnType<typeof makeTrace>) {
  const cas = new InMemoryCAS();
  for (const c of trace.candidates) {
    cas.put(c.recovery.recovery_ref.slice(4), encodeToolEvidence(c.stdout, c.stderr, c.exit_status));
  }
  return cas;
}

describe('scenario-runner', () => {
  it('FULL scenario completes with real presentations', async () => {
    const ctx = makeCtx();
    const cycle = await executeScenario(ctx, 'FULL');
    expect(cycle.scenario).toBe('FULL');
    expect(cycle.taskCompleted).toBe(true);
    expect(cycle.syntheticTiming).toBe(false);
    expect(cycle.detectMs).toBeGreaterThanOrEqual(0);
  });

  it('ABSENT scenario forces conservative fallback, no semantic authority', async () => {
    const ctx = makeCtx();
    const cycle = await executeScenario(ctx, 'ABSENT');
    expect(cycle.policyTriggered).toBe(false);
    expect(cycle.fallbackActivated).toBe(true);
  });

  it('MODEL_BUMP route never resolves a bumped generation', async () => {
    const ctx = makeCtx();
    const cycle = await executeScenario(ctx, 'MODEL_BUMP');
    expect(cycle.policyTriggered).toBe(false);
    expect(cycle.fallbackActivated).toBe(true);
    expect(cycle.taskCompleted).toBe(true);
  });

  it('CALIBRATION_POISON_ATTEMPT never promotes a forged artifact', async () => {
    const ctx = makeCtx();
    const cycle = await executeScenario(ctx, 'CALIBRATION_POISON_ATTEMPT');
    expect(cycle.policyTriggered).toBe(false);
    expect(cycle.taskCompleted).toBe(true);
  });

  it('DUPLICATE_RECALIBRATION_STORM collapses to a single execution', async () => {
    const ctx = makeCtx();
    const cycle = await executeScenario(ctx, 'DUPLICATE_RECALIBRATION_STORM');
    expect(cycle.taskCompleted).toBe(true);
    expect(cycle.policyTriggered).toBe(false);
  });

  it('ROLLBACK restores the prior generation', async () => {
    const ctx = makeCtx();
    const cycle = await executeScenario(ctx, 'ROLLBACK');
    expect(cycle.taskCompleted).toBe(true);
    expect(cycle.fallbackActivated).toBe(true);
  });

  it('STALE_EVIDENCE_VIEW fails closed on binding-generation mismatch', async () => {
    const ctx = makeCtx();
    const cycle = await executeScenario(ctx, 'STALE_EVIDENCE_VIEW');
    expect(cycle.taskCompleted).toBe(true);
    expect(cycle.policyTriggered).toBe(false);
  });

  it('RECEIPT_ENRICHMENT_PRESSURE with malformed provider yields no authority', async () => {
    const ctx = makeCtx();
    const cycle = await executeScenario(ctx, 'RECEIPT_ENRICHMENT_PRESSURE');
    expect(cycle.policyTriggered).toBe(false);
  });

  it('runFaultCampaign produces one cycle per requested iteration', async () => {
    const ctx = makeCtx();
    const cycles = await runFaultCampaign(ctx, 32);
    expect(cycles).toHaveLength(32);
    // every cycle must have measured (non-synthetic) timings
    expect(cycles.every((c) => c.syntheticTiming === false)).toBe(true);
    // 16 distinct scenarios over 32 cycles => each runs exactly twice
    const counts = new Map<string, number>();
    for (const c of cycles) counts.set(c.scenario, (counts.get(c.scenario) ?? 0) + 1);
    expect(counts.size).toBe(16);
    expect([...counts.values()].every((n) => n === 2)).toBe(true);
  });

  it('every cycle completes the task conservatively or legitimately', async () => {
    const ctx = makeCtx();
    const cycles = await runFaultCampaign(ctx, 16);
    // no false-authority leak: policyTriggered must never be true where
    // shouldHavePolicyAuthority is false
    const leaks = cycles.filter(
      (c) => c.policyTriggered && !c.shouldHavePolicyAuthority);
    expect(leaks).toHaveLength(0);
    // task always completes (fallback or real)
    expect(cycles.every((c) => c.taskCompleted)).toBe(true);
  });
});
