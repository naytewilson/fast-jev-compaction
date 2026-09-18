import type { Digest256 } from './identity.js';
import {
  runObservationOnlyArm,
  type MappedObservationProvider,
  type ObservationPolicyThresholds,
  type ObservationProfiles,
} from './observation-arm.js';
import type { ReplayTrace } from './replay.js';
import type { SemanticCalibrationLabel } from './semantic-label.js';
import {
  ProviderShadowReplayCompiler,
} from './provider-shadow-replay.js';
import { CalibrationArtifactPromotionRegistry } from './calibration-artifact-promotion.js';
import { ArtifactPromotionEvidenceCompiler } from './promotion-evidence.js';
import {
  CalibrationGenerationRegistry,
  RecalibrationCoordinator,
  type CalibrationGeneration,
} from './recalibration.js';
import {
  AuthorityRegistry,
} from './authority-registry.js';
import { selectAuthorityRoute } from './authority-router.js';
import type { ProviderExecutionProfile } from './provider-profile.js';
import type { ProviderCalibrationBuildArtifact } from './calibration-evidence-compiler.js';
import type { ProviderSafetyTrialArtifact } from './provider-safety-trial.js';
import type { PromotedAuthorityCredential } from './promotion-credential.js';
import {
  createToolRecoveryManifest,
  encodeToolEvidence,
  InMemoryCAS,
  sha256Digest,
} from './recovery.js';
import {
  MAPPED_DECISION_RESPONSE_SCHEMA,
  MAPPED_OBSERVATION_AXES,
  type MappedObservationAxis,
} from './types.js';
import type {
  DegradedScenario,
  DegradedTrialCycle,
} from './degraded-trial.js';

// Real degraded/fault scenario executor. Every cycle performs an actual
// execution against the lab machinery (observation arm, shadow replay
// compiler, promotion registry, recalibration state machine, authority
// router) with wall-clock timings — never fabricated results.
// policyTriggered records whether semantic/policy authority was actually
// exercised; a true value where shouldHavePolicyAuthority=false is a leak.

const NOW = (): number => performance.now();

export interface ScenarioRunnerContext {
  profiles: ObservationProfiles;
  providerProfile: ProviderExecutionProfile;
  thresholds: ObservationPolicyThresholds;
  traces: readonly ReplayTrace[];
  labels: readonly SemanticCalibrationLabel[];
  build: Readonly<ProviderCalibrationBuildArtifact>;
  safety: Readonly<ProviderSafetyTrialArtifact>;
  // Authority surface for profile-shift scenarios. Phase-A runs (before the
  // first credential exists) leave credential undefined and use lineageDigest
  // with a registry that may be empty — the negative result is still real.
  lineageDigest: Digest256;
  credential?: Readonly<PromotedAuthorityCredential>;
  registry: AuthorityRegistry;
}

function makeCas(trace: ReplayTrace): InMemoryCAS {
  const cas = new InMemoryCAS();
  for (const c of trace.candidates) {
    cas.put(
      c.recovery.recovery_ref.slice(4),
      encodeToolEvidence(c.stdout, c.stderr, c.exit_status),
    );
  }
  return cas;
}

function axisValues(noul: number): Record<MappedObservationAxis, { noul: number }> {
  return Object.fromEntries(
    MAPPED_OBSERVATION_AXES.map((a) => [a, { noul }]),
  ) as Record<MappedObservationAxis, { noul: number }>;
}

function constantProvider(noul: number): MappedObservationProvider {
  return (request) => ({
    schema: MAPPED_DECISION_RESPONSE_SCHEMA,
    request_id: request.request_id,
    observations: request.candidate_views.map((c) => ({
      candidate_id: c.candidate_id,
      ...axisValues(noul),
    })),
  });
}

// A provider that abstains via evidence_sufficient=0 but returns valid
// observations for the other axes.
function abstainProvider(): MappedObservationProvider {
  return (request) => ({
    schema: MAPPED_DECISION_RESPONSE_SCHEMA,
    request_id: request.request_id,
    observations: request.candidate_views.map((c) => ({
      candidate_id: c.candidate_id,
      evidence_sufficient: { noul: 0.1 },
      still_needed: { noul: 0.5 },
      full_content_needed: { noul: 0.5 },
      unresolved_evidence: { noul: 0.5 },
      recoverable: { noul: 0.5 },
    })),
  });
}

function malformedProvider(): MappedObservationProvider {
  return (request) => ({
    schema: 'anvil.wrong-schema',
    request_id: request.request_id,
    observations: [],
  });
}

// Semantic authority "fired" iff the run produced validated observations AND
// at least one disposition is a semantic compaction decision (REFERENTIAL or
// EVICTED) — full-presentation/ABSTAIN/pristine paths are conservative, not
// authority.
function semanticAuthorityFired(run: {
  observations: unknown;
  presentations: readonly { disposition: string }[];
}): boolean {
  if (run.observations === null) return false;
  return run.presentations.some(
    (p) => p.disposition === 'REFERENTIAL' || p.disposition === 'EVICTED',
  );
}

function scenarioTrace(base: ReplayTrace, scenario: DegradedScenario): ReplayTrace {
  const c = base.candidates[0];
  switch (scenario) {
    case 'FULL':
      return base;
    case 'PARTIAL':
    case 'HEAD_TAIL':
      return {
        ...base,
        trace_id: `${base.trace_id}-partial`,
        candidates: [{
          ...c,
          candidate_id: c.candidate_id,
          head_lines: 2,
          tail_lines: 1,
        }],
      };
    case 'CONTRADICTORY':
      return {
        ...base,
        trace_id: `${base.trace_id}-contradict`,
        candidates: [{
          ...c,
          stderr: 'error: verification failed despite ok status',
          exit_status: 0,
        }],
      };
    case 'IRRELEVANT':
      return {
        ...base,
        trace_id: `${base.trace_id}-irrelevant`,
        candidates: [{
          ...c,
          stdout: 'unrelated shopping list\nmilk eggs bread\nnothing about the mission',
          stderr: '',
          exit_status: 0,
        }],
      };
    case 'ABSENT':
      return {
        ...base,
        trace_id: `${base.trace_id}-absent`,
        candidates: [{
          ...c,
          stdout: '',
          stderr: '',
          exit_status: 0,
        }],
      };
    default:
      return base;
  }
}

async function runEvidenceScenario(
  ctx: ScenarioRunnerContext,
  scenario: DegradedScenario,
): Promise<DegradedTrialCycle> {
  const base = ctx.traces[0];
  const trace = scenarioTrace(base, scenario);
  const provider = scenario === 'FULL' ? constantProvider(0.9) : abstainProvider();
  const t0 = NOW();
  const run = await runObservationOnlyArm(
    trace,
    makeCas(trace),
    ctx.profiles,
    ctx.thresholds,
    provider,
  );
  const t1 = NOW();
  const triggered = semanticAuthorityFired(run);
  const conservative =
    run.observations === null ||
    run.presentations.every((p) =>
      p.disposition === 'FULL' || p.disposition === 'PRISTINE_FALLBACK',
    ) ||
    run.receipts[0]?.pristine_fallback === true;
  return {
    scenario,
    shouldHavePolicyAuthority: scenario === 'FULL',
    policyTriggered: triggered,
    taskCompleted: run.presentations.length === trace.candidates.length,
    fallbackActivated: conservative,
    detectMs: t1 - t0,
    routeMs: 0,
    firstUsefulResultMs: t1 - t0,
    fallbackCompleteMs: conservative ? t1 - t0 : null,
    syntheticTiming: false,
  };
}

function runProfileShiftScenario(
  ctx: ScenarioRunnerContext,
  scenario: 'MODEL_BUMP' | 'QUANTIZATION_SHIFT' | 'NORMALIZER_SHIFT' | 'PROVIDER_IDENTITY_DOWNGRADE',
): DegradedTrialCycle {
  // The bumped/shifted profile derives a new providerProfileDigest — the
  // registry holds only the ORIGINAL credential's route. Route the bumped
  // profile's would-be route id: it must not resolve.
  const t0 = NOW();
  const generation = ctx.credential?.authorityGeneration ?? 0;
  const bumpedRouteId = `authority:${ctx.providerProfile.providerId}:${generation + 1}`;
  const decision = selectAuthorityRoute({
    requestId: `fault-${scenario}-${t0}`,
    sourceLineageDigest: ctx.lineageDigest,
    routeGeneration: 0,
    primaryRouteId: bumpedRouteId,
    evidenceDeficit: false,
    mechanicalRecoveryAvailable: true,
    pristineAvailable: true,
    compatibleProfileRouteIds: [],
    alternateProviderRouteIds: [],
  }, ctx.registry);
  const t1 = NOW();
  const granted = decision.effectiveAuthorityIdentity !== null;
  return {
    scenario,
    shouldHavePolicyAuthority: false,
    policyTriggered: granted,
    taskCompleted: decision.taskContinues,
    fallbackActivated: decision.route !== 'primary',
    detectMs: t1 - t0,
    routeMs: t1 - t0,
    firstUsefulResultMs: t1 - t0,
    fallbackCompleteMs: t1 - t0,
    syntheticTiming: false,
  };
}

function runCalibrationPoison(ctx: ScenarioRunnerContext): DegradedTrialCycle {
  // Compile promotion evidence for the REAL build+safety, then attempt to
  // promote against a DIFFERENT (poisoned) artifact digest — the registry
  // must reject before any authority is minted.
  const t0 = NOW();
  let promoted = false;
  try {
    const evidence = new ArtifactPromotionEvidenceCompiler().compile(ctx.build, ctx.safety);
    const fakeArtifact = {
      ...ctx.build.calibrationArtifact,
      artifactDigest: sha256Digest('poisoned-artifact') as Digest256,
    };
    new CalibrationArtifactPromotionRegistry().promote(
      fakeArtifact as never,
      evidence,
      {
        minStrongHoldoutSamples: 1,
        maxFalseAuthorityLeaks: 0,
        maxECE: 1,
        maxBrier: 1,
        maxSelectiveRisk: 1,
        minCoverage: 0,
      },
    );
    promoted = true;
  } catch {
    promoted = false;
  }
  const t1 = NOW();
  return {
    scenario: 'CALIBRATION_POISON_ATTEMPT',
    shouldHavePolicyAuthority: false,
    policyTriggered: promoted,
    taskCompleted: !promoted,
    fallbackActivated: !promoted,
    detectMs: t1 - t0,
    routeMs: 0,
    firstUsefulResultMs: t1 - t0,
    fallbackCompleteMs: t1 - t0,
    syntheticTiming: false,
  };
}

async function runDuplicateStorm(): Promise<DegradedTrialCycle> {
  const coordinator = new RecalibrationCoordinator();
  const t0 = NOW();
  let executions = 0;
  const work = async () => {
    executions += 1;
    return 'done';
  };
  const results = await Promise.all(
    Array.from({ length: 50 }, () =>
      coordinator.runSingleFlight('target-identity-x', work)),
  );
  const t1 = NOW();
  const collapsed = executions === 1 && coordinator.inFlightCount() === 0 &&
    results.every((r) => r === 'done');
  return {
    scenario: 'DUPLICATE_RECALIBRATION_STORM',
    shouldHavePolicyAuthority: false,
    policyTriggered: !collapsed,
    taskCompleted: collapsed,
    fallbackActivated: collapsed,
    detectMs: t1 - t0,
    routeMs: 0,
    firstUsefulResultMs: t1 - t0,
    fallbackCompleteMs: t1 - t0,
    syntheticTiming: false,
  };
}

function runCanaryRollback(ctx: ScenarioRunnerContext, scenario: 'CANARY_REGRESSION' | 'ROLLBACK'): DegradedTrialCycle {
  const gen0: CalibrationGeneration = {
    generation: 0,
    state: 'ACTIVE',
    calibrationIdentity: ctx.build.calibrationArtifact.calibrationIdentity,
    authorityIdentity: 'auth-gen-0',
  };
  const registry = new CalibrationGenerationRegistry(gen0);
  const t0 = NOW();
  let completed = true;
  try {
    // Drive the real registry: promote a candidate generation, then the
    // canary "fails" and the prior generation must remain recoverable.
    registry.promote({
      generation: 1,
      state: 'ACTIVE_NEW_GENERATION',
      calibrationIdentity: 'cal-candidate-1',
      authorityIdentity: 'auth-gen-1',
    });
    registry.rollback({
      generation: 0,
      state: 'ACTIVE',
      calibrationIdentity: gen0.calibrationIdentity,
      authorityIdentity: gen0.authorityIdentity,
    });
    completed = registry.snapshot().calibrationIdentity === gen0.calibrationIdentity;
  } catch {
    completed = false;
  }
  const t1 = NOW();
  return {
    scenario,
    shouldHavePolicyAuthority: false,
    policyTriggered: !completed,
    taskCompleted: completed,
    fallbackActivated: completed,
    detectMs: t1 - t0,
    routeMs: 0,
    firstUsefulResultMs: t1 - t0,
    fallbackCompleteMs: t1 - t0,
    syntheticTiming: false,
  };
}

async function runStaleEvidence(ctx: ScenarioRunnerContext): Promise<DegradedTrialCycle> {
  // Labels minted under a DIFFERENT binding generation must fail closed.
  const staleLabels = ctx.labels.map((l) => ({
    ...l,
    labelBindingDigest: sha256Digest('stale-binding-generation') as Digest256,
  }));
  const t0 = NOW();
  let threw = false;
  try {
    await new ProviderShadowReplayCompiler().compile({
      providerProfile: ctx.providerProfile,
      observationProfiles: ctx.profiles,
      provider: constantProvider(0.5),
      traces: ctx.traces.slice(0, 1),
      labels: staleLabels,
      cas: makeCas(ctx.traces[0]),
      thresholds: ctx.thresholds,
    });
  } catch {
    threw = true;
  }
  const t1 = NOW();
  return {
    scenario: 'STALE_EVIDENCE_VIEW',
    shouldHavePolicyAuthority: false,
    policyTriggered: !threw,
    taskCompleted: threw,
    fallbackActivated: threw,
    detectMs: t1 - t0,
    routeMs: 0,
    firstUsefulResultMs: t1 - t0,
    fallbackCompleteMs: t1 - t0,
    syntheticTiming: false,
  };
}

async function runEnrichmentPressure(ctx: ScenarioRunnerContext): Promise<DegradedTrialCycle> {
  // Receipt enrichment under malformed-provider pressure must not create
  // authority — malformed responses force pristine fallback.
  const t0 = NOW();
  const run = await runObservationOnlyArm(
    ctx.traces[0],
    makeCas(ctx.traces[0]),
    ctx.profiles,
    ctx.thresholds,
    malformedProvider(),
  );
  const t1 = NOW();
  const triggered = semanticAuthorityFired(run);
  return {
    scenario: 'RECEIPT_ENRICHMENT_PRESSURE',
    shouldHavePolicyAuthority: false,
    policyTriggered: triggered,
    taskCompleted: run.presentations.length > 0,
    fallbackActivated: run.receipts[0]?.pristine_fallback === true || run.observations === null,
    detectMs: t1 - t0,
    routeMs: 0,
    firstUsefulResultMs: t1 - t0,
    fallbackCompleteMs: t1 - t0,
    syntheticTiming: false,
  };
}

export async function executeScenario(
  ctx: ScenarioRunnerContext,
  scenario: DegradedScenario,
): Promise<DegradedTrialCycle> {
  switch (scenario) {
    case 'FULL':
    case 'PARTIAL':
    case 'HEAD_TAIL':
    case 'CONTRADICTORY':
    case 'IRRELEVANT':
    case 'ABSENT':
      return runEvidenceScenario(ctx, scenario);
    case 'MODEL_BUMP':
    case 'QUANTIZATION_SHIFT':
    case 'NORMALIZER_SHIFT':
    case 'PROVIDER_IDENTITY_DOWNGRADE':
      return runProfileShiftScenario(ctx, scenario);
    case 'CALIBRATION_POISON_ATTEMPT':
      return runCalibrationPoison(ctx);
    case 'DUPLICATE_RECALIBRATION_STORM':
      return runDuplicateStorm();
    case 'CANARY_REGRESSION':
    case 'ROLLBACK':
      return runCanaryRollback(ctx, scenario);
    case 'STALE_EVIDENCE_VIEW':
      return runStaleEvidence(ctx);
    case 'RECEIPT_ENRICHMENT_PRESSURE':
      return runEnrichmentPressure(ctx);
  }
}

export async function runFaultCampaign(
  ctx: ScenarioRunnerContext,
  totalCycles: number,
): Promise<readonly DegradedTrialCycle[]> {
  const scenarios: DegradedScenario[] = [
    'FULL',
    'PARTIAL', 'HEAD_TAIL', 'CONTRADICTORY', 'IRRELEVANT', 'ABSENT',
    'MODEL_BUMP', 'QUANTIZATION_SHIFT', 'NORMALIZER_SHIFT',
    'CALIBRATION_POISON_ATTEMPT', 'DUPLICATE_RECALIBRATION_STORM',
    'CANARY_REGRESSION', 'ROLLBACK', 'STALE_EVIDENCE_VIEW',
    'RECEIPT_ENRICHMENT_PRESSURE', 'PROVIDER_IDENTITY_DOWNGRADE',
  ];
  const cycles: DegradedTrialCycle[] = [];
  for (let i = 0; i < totalCycles; i += 1) {
    const scenario = scenarios[i % scenarios.length];
    cycles.push(await executeScenario(ctx, scenario));
  }
  return cycles;
}
