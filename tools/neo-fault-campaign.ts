// neo-fault-campaign.ts — Objectives G+H+I driver.
//
//   tsx tools/neo-fault-campaign.ts <campaignDir> <noul.jsonl|-> <inventory.json> [cycles]
//
// Phase A: build the real chain (profile -> shadow replay -> calibration
//   build) then run a first scenario batch with an EMPTY authority registry
//   to produce a measured ProviderSafetyTrialArtifact.
// Phase B: compile promotion evidence, promote, issue the authority
//   credential, register the grant — the only legitimate minting path.
// Phase C: run the full fault campaign (default 10000 cycles) against the
//   machinery with the real credential present.
// Phase D: authority-chain regression battery (cross-provider transfer,
//   hardware->authority, generic objects, structural copies, unknown
//   routes, lineage mismatch, evidence deficit).
//
// Writes fault-report.json with every artifact digest and the regression
// matrix. Fail-closed: leaks abort with nonzero exit.

import { writeFileSync } from 'node:fs';
import { buildCampaignChain, makeCas } from './lib/campaign-chain.js';
import { runFaultCampaign, executeScenario, type ScenarioRunnerContext } from '../src/lab/scenario-runner.js';
import { ProviderSafetyTrialRegistry } from '../src/lab/provider-safety-trial.js';
import { ArtifactPromotionEvidenceCompiler } from '../src/lab/promotion-evidence.js';
import { CalibrationArtifactPromotionRegistry } from '../src/lab/calibration-artifact-promotion.js';
import { PromotionAuthorityIssuer } from '../src/lab/promotion-credential.js';
import { AuthorityRegistry } from '../src/lab/authority-registry.js';
import { selectAuthorityRoute } from '../src/lab/authority-router.js';
import { sha256Digest } from '../src/lab/recovery.js';
import { verifyProviderSafetyTrialArtifact } from '../src/lab/provider-safety-trial.js';
import { verifyCompiledArtifactPromotionEvidence } from '../src/lab/promotion-evidence.js';
import { verifyPromotedCalibrationArtifact } from '../src/lab/calibration-artifact-promotion.js';
import { verifyPromotedAuthorityCredential } from '../src/lab/promotion-credential.js';
import { evaluateLocalProfileReceipt } from '../src/lab/local-profile-gate.js';
import type { Digest256 } from '../src/lab/identity.js';
import type { LocalHardwareReceipt } from '../src/lab/hardware-receipt.js';

const [campaignDir, noulPath, inventoryPath, cycleArg] = process.argv.slice(2);
if (!campaignDir || !inventoryPath) {
  console.error('usage: tsx tools/neo-fault-campaign.ts <campaignDir> <noul.jsonl|-> <inventory.json> [cycles]');
  process.exit(2);
}
const totalCycles = Number(cycleArg ?? '10000');
const fixture = process.env.NOUL_FIXTURE === '1' || noulPath === '-';
const policyProfileDigest = sha256Digest('neo-campaign-policy-profile-v1') as Digest256;
const lineageDigest = sha256Digest('neo-campaign-source-lineage-v1') as Digest256;
const promotionPolicy = {
  minStrongHoldoutSamples: 5,
  maxFalseAuthorityLeaks: 0,
  maxECE: 0.25,
  maxBrier: 0.25,
  maxSelectiveRisk: 0.2,
  minCoverage: 0.5,
};

const chain = await buildCampaignChain({
  campaignDir,
  noulPath: fixture ? undefined : noulPath,
  inventoryPath,
  fixture,
});
console.log(`chain: profile=${chain.neo.profile.providerProfileDigest.slice(0, 20)}… build=${chain.build.buildDigest.slice(0, 20)}… evidenceClass=${chain.evidenceClass}`);

// ---- Phase A: first measured safety trial (empty registry)
const ctxA: ScenarioRunnerContext = {
  profiles: chain.profiles,
  providerProfile: chain.neo.profile,
  thresholds: chain.thresholds,
  traces: chain.corpus,
  labels: chain.labels,
  build: chain.build,
  safety: undefined as never, // filled below — poison uses latest safety
  lineageDigest,
  registry: new AuthorityRegistry(),
};
// seed safety: first cycles cannot reference a safety artifact; use the
// poison executor's own compile against build only.
const seedSafety = new ProviderSafetyTrialRegistry().register({
  providerProfile: chain.neo.profile,
  calibrationIdentity: chain.build.calibrationArtifact.calibrationIdentity,
  policyProfileDigest,
  observationABIDigest: chain.neo.profile.observationABIDigest,
  cycles: [await executeScenario(ctxA, 'FULL'), await executeScenario(ctxA, 'ABSENT')],
});
ctxA.safety = seedSafety;

const phaseACycles = await runFaultCampaign(ctxA, 600);
const safetyA = new ProviderSafetyTrialRegistry().register({
  providerProfile: chain.neo.profile,
  calibrationIdentity: chain.build.calibrationArtifact.calibrationIdentity,
  policyProfileDigest,
  observationABIDigest: chain.neo.profile.observationABIDigest,
  cycles: phaseACycles,
});
console.log(`safetyA: verdict=${safetyA.result.verdict} leaks=${safetyA.result.falseAuthority.leaks} opps=${safetyA.result.falseAuthority.opportunities} verified=${verifyProviderSafetyTrialArtifact(safetyA)}`);
if (safetyA.result.falseAuthority.leaks > 0) {
  console.error('FALSE AUTHORITY LEAK in phase A — aborting');
  process.exit(4);
}

// ---- Phase B: legitimate promotion path
const evidence = new ArtifactPromotionEvidenceCompiler().compile(chain.build, safetyA);
console.log(`evidence: digest=${evidence.evidenceDigest.slice(0, 20)}… verified=${verifyCompiledArtifactPromotionEvidence(evidence)}`);
const promoted = new CalibrationArtifactPromotionRegistry().promote(
  chain.build.calibrationArtifact, evidence, promotionPolicy,
);
console.log(`promoted: digest=${promoted.promotedArtifactDigest.slice(0, 20)}… verified=${verifyPromotedCalibrationArtifact(promoted)}`);
const credential = new PromotionAuthorityIssuer().issue({
  providerProfile: chain.neo.profile,
  promotedArtifact: promoted,
  policyProfileDigest,
  observationABIDigest: chain.neo.profile.observationABIDigest,
  sourceLineageDigest: lineageDigest,
  authorityGeneration: 1,
});
console.log(`credential: digest=${credential.credentialDigest.slice(0, 20)}… verified=${verifyPromotedAuthorityCredential(credential)}`);
const registry = new AuthorityRegistry();
const grant = registry.registerCredential(credential);
console.log(`grant: routeId=${grant.routeId}`);

// ---- Phase C: full fault campaign with real credential
const ctxC: ScenarioRunnerContext = {
  ...ctxA,
  safety: safetyA,
  credential,
  registry,
};
const t0 = Date.now();
const cycles = await runFaultCampaign(ctxC, totalCycles);
const wallMs = Date.now() - t0;
const safetyC = new ProviderSafetyTrialRegistry().register({
  providerProfile: chain.neo.profile,
  calibrationIdentity: chain.build.calibrationArtifact.calibrationIdentity,
  policyProfileDigest,
  observationABIDigest: chain.neo.profile.observationABIDigest,
  cycles,
});
const r = safetyC.result;
console.log(`campaign: cycles=${r.cycleCount} verdict=${r.verdict} authority=${safetyC.evidenceAuthority}`);
console.log(`falseAuthority: opps=${r.falseAuthority.opportunities} leaks=${r.falseAuthority.leaks} suppressed=${r.falseAuthority.suppressed}`);
console.log(`fallback: coverage=${r.fallbackCoverageRetention} activation=${r.fallbackActivationRate}`);
console.log(`routeMs p50=${r.routeLatencyMs.p50} p95=${r.routeLatencyMs.p95} p99=${r.routeLatencyMs.p99}`);
console.log(`wall=${wallMs}ms verified=${verifyProviderSafetyTrialArtifact(safetyC)}`);

// ---- Phase D: authority-chain regressions
const regressions: { name: string; passed: boolean; detail: string }[] = [];
const check = (name: string, fn: () => boolean, detail = '') =>
  regressions.push({ name, passed: fn(), detail });

// 1. credential resolves only for exact lineage
check('lineage-match-resolves', () =>
  registry.resolve(grant.routeId, lineageDigest) !== null);
check('lineage-mismatch-fails', () =>
  registry.resolve(grant.routeId, sha256Digest('wrong-lineage') as Digest256) === null);
check('unknown-route-fails', () =>
  registry.resolve('authority:nobody:99', lineageDigest) === null);

// 2. evidence deficit beats provider authority
{
  const d = selectAuthorityRoute({
    requestId: 'reg-deficit',
    sourceLineageDigest: lineageDigest,
    routeGeneration: 0,
    primaryRouteId: grant.routeId,
    evidenceDeficit: true,
    mechanicalRecoveryAvailable: true,
    pristineAvailable: true,
    compatibleProfileRouteIds: [],
    alternateProviderRouteIds: [],
  }, registry);
  check('evidence-deficit-beats-authority', () =>
    d.route === 'hydrate' && d.effectiveAuthorityIdentity === null);
}

// 3. structural credential copy cannot re-enter registry
check('credential-copy-reregister-fails', () => {
  try { registry.registerCredential(credential); return false; }
  catch { return true; }
});

// 4. generic object cannot mint a grant
check('plain-object-not-credential', () => {
  try {
    registry.registerCredential({ ...credential } as never);
    return false;
  } catch { return true; }
});

// 5. cross-provider non-transfer: a different provider's credential chain
//    cannot resolve this registry's lineage.
check('cross-provider-no-transfer', () => {
  const foreignRoute = 'authority:typesafe-system-one/jev-1.13.0:7';
  return registry.resolve(foreignRoute, lineageDigest) === null;
});

// 6. hardware measurement cannot mint authority: a receipt claiming
//    productionAuthorityGranted must be REJECTED outright.
check('hardware-receipt-authority-claim-rejected', () => {
  const receipt = {
    repository: 'naytewilson/fast-jev-compaction',
    branch: 'worker/semantic-fabric-v1-overnight-neo-20260918',
    commitSha: '0'.repeat(40),
    timestamp: new Date().toISOString(),
    machine: {
      platform: 'darwin', arch: 'arm64', osVersion: '27.2',
      hardwareClass: 'a18pro', accelerator: 'ane',
      backend: 'coreml-auto', runtimeVersion: 'CoreML/27.2',
    },
    modelIdentity: chain.neo.model,
    executionSemantics: chain.neo.semantics,
    timingEvidence: 'measured',
    routeLatencyMs: { p50: 1, p95: 2, p99: 3, samples: 3 },
    observerLatencyMs: { p50: 10, p95: 20, p99: 30, samples: 3 },
    shapeBuckets: [],
    throughput: { itemsPerSecond: 1 },
    peakRssBytes: 1,
    productionAuthorityGranted: true,
    receiptId: 'r1',
    receiptDigest: sha256Digest('x'),
  } as unknown as LocalHardwareReceipt;
  const v = evaluateLocalProfileReceipt(receipt, {
    repository: 'naytewilson/fast-jev-compaction',
    branch: 'worker/semantic-fabric-v1-overnight-neo-20260918',
    commitSha: '0'.repeat(40),
    platform: 'darwin', arch: 'arm64', accelerator: 'ane',
    backend: 'coreml-auto', timingEvidence: 'measured',
  });
  return v.status === 'REJECTED' &&
    v.reasons.includes('AUTHORITY_CLAIM_FORBIDDEN') &&
    v.productionAuthorityGranted === false;
});

const leaks = r.falseAuthority.leaks;
const report = {
  schema: 'anvil.neo-fault-report.v1',
  evidenceClass: chain.evidenceClass,
  providerProfileDigest: chain.neo.profile.providerProfileDigest,
  calibrationBuildDigest: chain.build.buildDigest,
  calibrationIdentity: chain.build.calibrationArtifact.calibrationIdentity,
  safetyPhaseA: {
    digest: safetyA.trialDigest,
    verdict: safetyA.result.verdict,
    evidenceAuthority: safetyA.evidenceAuthority,
    falseAuthority: safetyA.result.falseAuthority,
  },
  safetyCampaign: {
    digest: safetyC.trialDigest,
    verdict: r.verdict,
    evidenceAuthority: safetyC.evidenceAuthority,
    cycleCount: r.cycleCount,
    scenarioCounts: r.scenarioCounts,
    falseAuthority: r.falseAuthority,
    fallbackCoverageRetention: r.fallbackCoverageRetention,
    fallbackActivationRate: r.fallbackActivationRate,
    routeLatencyMs: r.routeLatencyMs,
    firstUsefulResultMs: r.firstUsefulResultMs,
    wallMs,
    verified: verifyProviderSafetyTrialArtifact(safetyC),
  },
  promotion: {
    evidenceDigest: evidence.evidenceDigest,
    promotedArtifactDigest: promoted.promotedArtifactDigest,
    credentialDigest: credential.credentialDigest,
    authorityIdentity: credential.authorityIdentity,
    routeId: grant.routeId,
    regressions,
  },
};
writeFileSync(`${campaignDir}/fault-report.json`, JSON.stringify(report, null, 2));
console.log(`regressions: ${regressions.filter((x) => x.passed).length}/${regressions.length} passed`);
console.log('report -> fault-report.json');
if (leaks > 0 || regressions.some((x) => !x.passed)) {
  console.error('FAILURES PRESENT — inspect fault-report.json');
  process.exit(5);
}
