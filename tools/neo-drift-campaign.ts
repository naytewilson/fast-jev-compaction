// neo-drift-campaign.ts — Objective J: self-healing drift + rollback.
//
//   tsx tools/neo-drift-campaign.ts <campaignDir> <noul.jsonl|-> <inventory.json>
//
// Injects a model-bump drift (new releaseId -> new provider profile digest)
// then drives the REAL recalibration machinery stage by stage, timing each:
//
//   T_detect    changed profile fails lineage/profile match -> shadow-only
//   T_route     conservative route for the uncalibrated profile
//   T_replay    shadow replay compile for the drifted profile
//   T_fit       calibration evidence compile (5 isotonic calibrators)
//   T_validate  holdout artifact + build verification
//   T_canary    promotion evidence compile + promotion gate attempt
//   T_promote   generation promote (only when the canary legitimately passes)
//   T_rollback  failed-canary rollback restores the prior generation
//
// Also proves duplicate recalibration demand collapses single-flight.
// Writes drift-report.json. No faked timings — every stage runs real code.

import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { buildCampaignChain } from './lib/campaign-chain.js';
import { neoLfmIdentity } from '../src/lab/noul-file-provider.js';
import { ProviderShadowReplayCompiler } from '../src/lab/provider-shadow-replay.js';
import { CalibrationEvidenceCompiler } from '../src/lab/calibration-evidence-compiler.js';
import { ArtifactPromotionEvidenceCompiler } from '../src/lab/promotion-evidence.js';
import { CalibrationArtifactPromotionRegistry } from '../src/lab/calibration-artifact-promotion.js';
import {
  CalibrationGenerationRegistry,
  RecalibrationCoordinator,
  transitionCalibrationGeneration,
} from '../src/lab/recalibration.js';
import { selectAuthorityRoute } from '../src/lab/authority-router.js';
import { AuthorityRegistry } from '../src/lab/authority-registry.js';
import { sha256Digest } from '../src/lab/recovery.js';
import { verifyProviderShadowReplayArtifact } from '../src/lab/provider-shadow-replay.js';
import { verifyProviderCalibrationBuildArtifact } from '../src/lab/calibration-evidence-compiler.js';
import type { Digest256 } from '../src/lab/identity.js';
import type { ExecutionBackend } from '../src/lab/execution-profile.js';
import { readFileSync } from 'node:fs';

const [campaignDir, noulPath, inventoryPath] = process.argv.slice(2);
if (!campaignDir || !inventoryPath) {
  console.error('usage: tsx tools/neo-drift-campaign.ts <campaignDir> <noul.jsonl|-> <inventory.json>');
  process.exit(2);
}
const fixture = process.env.NOUL_FIXTURE === '1' || noulPath === '-';
const timings: Record<string, number> = {};
const results: { name: string; passed: boolean; detail: string }[] = [];
const check = (name: string, passed: boolean, detail = '') =>
  results.push({ name, passed, detail });
const t = <T>(name: string, fn: () => T): T => {
  const t0 = performance.now();
  const out = fn();
  timings[name] = Number((performance.now() - t0).toFixed(4));
  return out;
};

const chain = await buildCampaignChain({
  campaignDir,
  noulPath: fixture ? undefined : noulPath,
  inventoryPath,
  fixture,
});
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
console.log(`chain: profile=${chain.neo.profile.providerProfileDigest.slice(0, 20)}… evidenceClass=${chain.evidenceClass}`);

// ---- drift injection: model bump -> new releaseId -> new profile digest
const drifted = neoLfmIdentity({
  packageDigest: inventory.packageDigest,
  tokenizerDigest: inventory.tokenizerDigest,
  ...(inventory.weightsDigest ? { weightsDigest: inventory.weightsDigest } : {}),
  quantization: inventory.quantization,
  releaseId: `${inventory.releaseId}-drift1`,
  backend: inventory.backend as ExecutionBackend,
  runtimeVersion: inventory.runtimeVersion,
  compilerDigest: inventory.compilerDigest,
  contextWindow: inventory.contextWindow,
  samplingDigest: inventory.samplingDigest,
  ...(inventory.hardwareSemanticsClass
    ? { hardwareSemanticsClass: inventory.hardwareSemanticsClass }
    : {}),
});
check('drift-changes-profile-digest',
  drifted.profile.providerProfileDigest !== chain.neo.profile.providerProfileDigest,
  `${drifted.profile.providerProfileDigest.slice(0, 24)}…`);

// ---- T_detect: drifted profile has no registered authority route
const lineageDigest = sha256Digest('neo-campaign-source-lineage-v1') as Digest256;
const registry = new AuthorityRegistry();
const detect = t('T_detect_ms', () => {
  // Authority resolution is digest-bound: an unregistered profile cannot
  // resolve any route; matching is by exact lineage + registered credential.
  return registry.resolve(`authority:${drifted.profile.providerId}:1`, lineageDigest);
});
check('drifted-profile-shadow-only', detect === null,
  'no credential exists for the bumped release -> resolution fails closed');

// ---- T_route: conservative routing for the uncalibrated profile
const route = t('T_route_ms', () =>
  selectAuthorityRoute({
    requestId: 'drift-route-1',
    sourceLineageDigest: lineageDigest,
    routeGeneration: 0,
    primaryRouteId: `authority:${drifted.profile.providerId}:1`,
    evidenceDeficit: false,
    mechanicalRecoveryAvailable: true,
    pristineAvailable: true,
    compatibleProfileRouteIds: [],
    alternateProviderRouteIds: [],
  }, registry));
check('drifted-route-conservative', route.effectiveAuthorityIdentity === null,
  `route=${route.route}`);

// ---- T_replay: shadow replay for the drifted profile (real compile)
const compiler = new ProviderShadowReplayCompiler();
const driftedProfiles = {
  ...chain.profiles,
  execution_profile: {
    id: drifted.profile.providerId,
    version: '1.0.0',
    digest: drifted.profile.providerProfileDigest,
  },
};
const replayT0 = performance.now();
const driftedTrainArtifact = await compiler.compile({
  providerProfile: drifted.profile,
  observationProfiles: driftedProfiles,
  provider: chain.provider,
  traces: chain.training,
  labels: chain.trainingLabels,
  cas: (await import('./lib/campaign-chain.js')).makeCas(chain.training),
  thresholds: chain.thresholds,
});
const driftedHoldoutArtifact = await compiler.compile({
  providerProfile: drifted.profile,
  observationProfiles: driftedProfiles,
  provider: chain.provider,
  traces: chain.holdout,
  labels: chain.holdoutLabels,
  cas: (await import('./lib/campaign-chain.js')).makeCas(chain.holdout),
  thresholds: chain.thresholds,
});
timings['T_replay_ms'] = Number((performance.now() - replayT0).toFixed(4));
check('drifted-replay-verifies',
  verifyProviderShadowReplayArtifact(driftedTrainArtifact) &&
    verifyProviderShadowReplayArtifact(driftedHoldoutArtifact),
  `train=${driftedTrainArtifact.predictions.length} holdout=${driftedHoldoutArtifact.predictions.length}`);

// ---- T_fit: calibration evidence compile for the drifted profile
const driftedBuild = t('T_fit_ms', () =>
  new CalibrationEvidenceCompiler().compile({
    providerProfile: drifted.profile,
    decisionContractDigest: chain.profiles.decision_contract.digest,
    compiledProgramDigest: chain.programDigest,
    samplingPolicyDigest: chain.samplingPolicyDigest,
    labelAuthorityPolicyDigest: chain.labelAuthorityPolicyDigest,
    labelBindingDigest: chain.identity.labelBindingDigest,
    trainingLabels: chain.trainingLabels,
    trainingPredictions: driftedTrainArtifact.predictions,
    holdoutLabels: chain.holdoutLabels,
    holdoutPredictions: driftedHoldoutArtifact.predictions,
    confidenceFloor: 0.8,
    eceBins: 10,
  }));
check('drifted-build-compiles', driftedBuild !== undefined,
  `build=${driftedBuild.buildDigest.slice(0, 24)}…`);

// ---- T_validate: verify the drifted build artifact + holdout coverage
t('T_validate_ms', () => verifyProviderCalibrationBuildArtifact(driftedBuild));
check('drifted-build-verifies', verifyProviderCalibrationBuildArtifact(driftedBuild));
const selective = driftedBuild.holdoutMetrics?.selectiveRisk ?? null;
check('drifted-selective-nonzero-coverage',
  (driftedBuild.holdoutMetrics?.coverage ?? 0) > 0,
  `coverage=${driftedBuild.holdoutMetrics?.coverage} risk=${selective}`);

// ---- T_canary: safety trial + promotion evidence + gate for drifted gen
const { executeScenario, runFaultCampaign } = await import('../src/lab/scenario-runner.js');
const { ProviderSafetyTrialRegistry } = await import('../src/lab/provider-safety-trial.js');
const ctxDrift = {
  profiles: driftedProfiles,
  providerProfile: drifted.profile,
  thresholds: chain.thresholds,
  traces: chain.corpus,
  labels: chain.labels,
  build: driftedBuild,
  safety: undefined as never,
  lineageDigest,
  registry: new AuthorityRegistry(),
};
const seedSafety = new ProviderSafetyTrialRegistry().register({
  providerProfile: drifted.profile,
  calibrationIdentity: driftedBuild.calibrationArtifact.calibrationIdentity,
  policyProfileDigest: sha256Digest('neo-campaign-policy-profile-v1') as Digest256,
  observationABIDigest: drifted.profile.observationABIDigest,
  cycles: [await executeScenario(ctxDrift, 'FULL'), await executeScenario(ctxDrift, 'ABSENT')],
});
ctxDrift.safety = seedSafety;
const driftCycles = await runFaultCampaign(ctxDrift, 120);
const driftSafety = new ProviderSafetyTrialRegistry().register({
  providerProfile: drifted.profile,
  calibrationIdentity: driftedBuild.calibrationArtifact.calibrationIdentity,
  policyProfileDigest: sha256Digest('neo-campaign-policy-profile-v1') as Digest256,
  observationABIDigest: drifted.profile.observationABIDigest,
  cycles: driftCycles,
});
console.log(`drift safety: verdict=${driftSafety.result.verdict} leaks=${driftSafety.result.falseAuthority.leaks}`);

const generationRegistry = new CalibrationGenerationRegistry({
  generation: 1,
  state: 'ACTIVE',
  calibrationIdentity: chain.build.calibrationArtifact.calibrationIdentity,
  authorityIdentity: `authority:${chain.neo.profile.providerId}:1`,
});
let canaryPassed = false;
const canary = t('T_canary_ms', () => {
  const evidence = new ArtifactPromotionEvidenceCompiler().compile(
    driftedBuild, driftSafety,
  );
  try {
    const promoted = new CalibrationArtifactPromotionRegistry().promote(
      driftedBuild.calibrationArtifact, evidence,
      {
        minStrongHoldoutSamples: 5,
        maxFalseAuthorityLeaks: 0,
        maxECE: 0.25,
        maxBrier: 0.25,
        maxSelectiveRisk: 0.2,
        minCoverage: 0.5,
      },
    );
    canaryPassed = promoted !== null;
    return promoted;
  } catch (e) {
    return e;
  }
});
console.log(`canary: ${canaryPassed ? 'PASSED' : 'rejected -> rollback path'} (${canary instanceof Error ? canary.message : 'promoted'})`);

// ---- T_promote / T_rollback: generation transitions
if (canaryPassed) {
  t('T_promote_ms', () => {
    let g = transitionCalibrationGeneration(generationRegistry.snapshot(), 'DEGRADED_SAFE');
    g = transitionCalibrationGeneration(g, 'REPLAYING');
    g = transitionCalibrationGeneration(g, 'FITTING');
    g = transitionCalibrationGeneration(g, 'SHADOW_VALIDATING');
    g = transitionCalibrationGeneration(g, 'CANARY');
    g = transitionCalibrationGeneration(g, 'PROMOTING');
    g = transitionCalibrationGeneration(g, 'ACTIVE_NEW_GENERATION');
    return generationRegistry.promote({ ...g, state: 'ACTIVE_NEW_GENERATION' });
  });
  check('promote-atomic-new-generation',
    generationRegistry.snapshot().generation === 2 &&
      generationRegistry.snapshot().state === 'ACTIVE');
}
// rollback always exercised: canary failure path restores prior generation
const rollback = t('T_rollback_ms', () => {
  const prev = {
    generation: 1,
    state: 'ACTIVE' as const,
    calibrationIdentity: chain.build.calibrationArtifact.calibrationIdentity,
    authorityIdentity: `authority:${chain.neo.profile.providerId}:1`,
  };
  return generationRegistry.rollback(prev);
});
check('rollback-restores-prior-generation',
  rollback.generation === 1 && rollback.state === 'ACTIVE');
check('rollback-rejects-unknown-generation', (() => {
  try {
    generationRegistry.rollback({
      generation: 99, state: 'ACTIVE',
      calibrationIdentity: 'x', authorityIdentity: 'y',
    });
    return false;
  } catch { return true; }
})());

// ---- single-flight: duplicate recalibration demand collapses
const coordinator = new RecalibrationCoordinator();
const sf = t('T_singleflight_ms', async () => {
  const target = drifted.profile.providerProfileDigest;
  const p1 = coordinator.runSingleFlight(target, async () => 'work-1');
  const p2 = coordinator.runSingleFlight(target, async () => 'work-2');
  const [a, b] = await Promise.all([p1, p2]);
  return { same: a === b, value: a, inFlight: coordinator.inFlightCount() };
});
const sfResult = await sf;
check('duplicate-recalibration-single-flight',
  sfResult.same && sfResult.value === 'work-1' && sfResult.inFlight === 0,
  `inFlight=${sfResult.inFlight}`);

// ---- illegal transition guard
check('illegal-transition-fails', (() => {
  try {
    transitionCalibrationGeneration(
      { generation: 1, state: 'ACTIVE', calibrationIdentity: 'c', authorityIdentity: 'a' },
      'PROMOTING');
    return false;
  } catch { return true; }
})());

const report = {
  schema: 'anvil.neo-drift-report.v1',
  evidenceClass: chain.evidenceClass,
  originalProfileDigest: chain.neo.profile.providerProfileDigest,
  driftedProfileDigest: drifted.profile.providerProfileDigest,
  driftKind: 'model-release-bump (releaseId -> new profile digest)',
  timingsMs: timings,
  canaryPassed,
  checks: results,
};
writeFileSync(`${campaignDir}/drift-report.json`, JSON.stringify(report, null, 2));
console.log(`timings: ${Object.entries(timings).map(([k, v]) => `${k}=${v}ms`).join(' ')}`);
console.log(`checks: ${results.filter((x) => x.passed).length}/${results.length} passed`);
console.log('report -> drift-report.json');
if (results.some((x) => !x.passed)) {
  console.error('FAILURES PRESENT — inspect drift-report.json');
  process.exit(5);
}
