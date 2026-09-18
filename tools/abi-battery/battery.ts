// battery.ts — Semantic Observation ABI calibration battery orchestrator.
//
//   tsx tools/abi-battery/battery.ts mint  <outdir>
//   tsx tools/abi-battery/battery.ts run   <outdir> [phase]
//   tsx tools/abi-battery/battery.ts report <outdir>
//
// Phases: primary | repeat | permute | replay | all (default order).
// Execution is resumable: completed callIds in calls.jsonl are skipped.
// Live calls go through tools/abi-battery/live-jev.ts (egress-granted,
// bounded retry, fail-closed). Evidence class: live provider over a
// synthetic-fixture corpus — never production calibration authority.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import {
  buildExperimentCorpus,
  mintExperimentLabels,
  EXPERIMENT_CORPUS_ID,
  EXPERIMENT_VERIFIER_ID,
  type CorpusEntry,
} from './experiment-corpus.js';
import { captureCanonicalRequest, mergedTrace, permuteCandidateIds } from './requests.js';
import { executeLiveAxisCall, loadApiKey, JEV_MODEL, type LiveCallResult } from './live-jev.js';
import { executeMercuryAxisCall, loadMercuryBearer, MERCURY_MODEL } from './live-mercury.js';
import {
  FIVE_AXIS_EXPERIMENT_AXES,
  FOUR_AXIS_EXPERIMENT_AXES,
} from '../../src/lab/semantic-abi-experiment.js';
import {
  deriveObservationABIDigest,
} from '../../src/lab/noul-file-provider.js';
import { deriveProviderExecutionProfile } from '../../src/lab/provider-profile.js';
import { sha256Digest } from '../../src/lab/recovery.js';
import type { ReplayTrace } from '../../src/lab/replay.js';
import type { SemanticCalibrationLabel } from '../../src/lab/semantic-label.js';
import type { ObservationProfiles } from '../../src/lab/observation-arm.js';
import type { Digest256 } from '../../src/lab/identity.js';
import {
  MAPPED_OBSERVATION_AXES,
  type MappedDecisionRequest,
  type MappedObservationAxis,
} from '../../src/lab/types.js';

const FOUR_AXIS_ABI_ID = 'anvil.semantic-observation-abi.v2-candidate';

export type BatteryProvider = 'jev' | 'mercury';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

function decisionContractIdentity() {
  return {
    id: 'anvil.context-retention.v1',
    version: '1.0.0',
    digest: sha256Digest(JSON.stringify({
      schema: 'anvil.decision-contract-identity.v1',
      id: 'anvil.context-retention.v1',
      version: '1.0.0',
      axes: MAPPED_OBSERVATION_AXES,
    })) as Digest256,
  };
}

function fourAxisAbiDigest(): Digest256 {
  return sha256Digest(JSON.stringify({
    schema: 'anvil.observation-abi-identity.v1',
    abiVersion: FOUR_AXIS_ABI_ID,
    requestSchema: 'anvil.mapped-decision-request.v0',
    responseSchema: 'anvil.mapped-decision-response.v0',
    axes: FOUR_AXIS_EXPERIMENT_AXES,
  })) as Digest256;
}

function jevProfile(abiDigest: Digest256) {
  return deriveProviderExecutionProfile({
    providerId: 'typesafe-system-one/jev-1.13.0',
    providerKind: 'jev-system-one',
    modelIdentityDigest: sha256Digest(JSON.stringify({
      schema: 'anvil.provider-model-identity.v1',
      provider: 'typesafe-systemone',
      model: JEV_MODEL,
      assurance: 'opaqueVersioned',
    })) as Digest256,
    modelAssurance: 'opaqueVersioned',
    executionSemanticsDigest: sha256Digest(JSON.stringify({
      schema: 'anvil.remote-execution-semantics.v1',
      provider: 'typesafe-systemone',
      endpointHost: 'api.typesafe.ai',
      wireContract: 'systemone-mapped-payload.v0',
      retryPolicy: '429-529-only-max4-backoff-retry-after',
    })) as Digest256,
    normalizerDigest: sha256Digest(JSON.stringify({
      schema: 'anvil.provider-normalizer.v1',
      id: 'typesafe-systemone-noul',
      rule: 'provider-internal noul probability in [0,1]; normalization internals opaque to caller',
    })) as Digest256,
    observationABIDigest: abiDigest,
  });
}

function mercuryProfile(abiDigest: Digest256) {
  return deriveProviderExecutionProfile({
    providerId: 'local-agent-gateway-rune/inception-mercury-2',
    providerKind: 'custom',
    modelIdentityDigest: sha256Digest(JSON.stringify({
      schema: 'anvil.provider-model-identity.v1',
      provider: 'inception-via-local-agent-gateway-rune',
      model: MERCURY_MODEL,
      assurance: 'opaqueVersioned',
    })) as Digest256,
    modelAssurance: 'opaqueVersioned',
    executionSemanticsDigest: sha256Digest(JSON.stringify({
      schema: 'anvil.remote-execution-semantics.v1',
      provider: 'local-agent-gateway-rune',
      endpointHost: '127.0.0.1:8903',
      wireContract: 'openai-chat-completions-json-elicitation.v0',
      retryPolicy: '429-529-only-max4-backoff-retry-after',
    })) as Digest256,
    normalizerDigest: sha256Digest(JSON.stringify({
      schema: 'anvil.provider-normalizer.v1',
      id: 'mercury-selfreport-json',
      rule: 'self-reported probability in [0,1] elicited via strict JSON schema; NOT provider-internal noul',
    })) as Digest256,
    observationABIDigest: abiDigest,
  });
}

const PROVIDER_PROFILE_FNS: Record<BatteryProvider, (abiDigest: Digest256) => ReturnType<typeof jevProfile>> = {
  jev: jevProfile,
  mercury: mercuryProfile,
};

const PROVIDER_META: Record<BatteryProvider, { endpoint: string; model: string; credentialRef: string; boundary: string }> = {
  jev: {
    endpoint: 'https://api.typesafe.ai/v1/systemone',
    model: JEV_MODEL,
    credentialRef: 'TYPESAFE_API_KEY_FILE (~/.local/share/anvil-jev-decisiond/typesafe-api-key)',
    boundary: 'anvil.system-one-egress-grant.v0 scope=synthetic_fixture per exact request digest',
  },
  mercury: {
    endpoint: 'http://127.0.0.1:8903/v1/chat/completions',
    model: MERCURY_MODEL,
    credentialRef: 'MERCURY_GATEWAY_BEARER_FILE (~/.local/share/local-agent-gateway/rune/gateway-bearer)',
    boundary: 'fixture- source_run_id scope assertion; bearer via rune gateway; no SIEVE ingress required on this route',
  },
};

function profilesFor(execDigest: Digest256, execId: string, decisionContract: { id: string; version: string; digest: Digest256 }): ObservationProfiles {
  return {
    decision_contract: decisionContract,
    execution_profile: { id: execId, version: '1.0.0', digest: execDigest },
    calibration_profile: { id: 'abi-battery-shadow', version: '1.0.0', digest: sha256Digest('abi-battery-cal-profile') as Digest256 },
    policy_profile: { id: 'abi-battery-shadow-policy', version: '1.0.0', digest: sha256Digest('abi-battery-pol-profile') as Digest256 },
  };
}

// ---------------------------------------------------------------------------
// Mint
// ---------------------------------------------------------------------------

function gitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export async function mint(outdir: string, provider: BatteryProvider = 'jev'): Promise<void> {
  mkdirSync(outdir, { recursive: true });
  const entries = buildExperimentCorpus();
  const traces = entries.map((entry) => entry.trace);
  const corpusDigest = sha256Digest(JSON.stringify(traces)) as Digest256;
  const decisionContract = decisionContractIdentity();
  const labelBindingDigest = sha256Digest(JSON.stringify({
    schema: 'anvil.label-binding.v1',
    corpusId: EXPERIMENT_CORPUS_ID,
    corpusDigest,
    verifierIdentity: EXPERIMENT_VERIFIER_ID,
    generation: 1,
  })) as Digest256;
  const labels = mintExperimentLabels({ entries, decisionContractDigest: decisionContract.digest, labelBindingDigest });

  const abi5 = deriveObservationABIDigest();
  const abi4 = fourAxisAbiDigest();
  const profileFn = PROVIDER_PROFILE_FNS[provider];
  const meta = PROVIDER_META[provider];
  const profile5 = profileFn(abi5);
  const profile4 = profileFn(abi4);

  const corpusDoc = {
    schema: 'anvil.abi-battery-corpus.v1',
    corpusId: EXPERIMENT_CORPUS_ID,
    corpusDigest,
    evidenceClass: 'synthetic-fixture',
    entries: entries.map((entry) => ({
      spec: entry.spec,
      trace: entry.trace,
      targets: entry.targets,
    })),
  };
  writeFileSync(`${outdir}/corpus.json`, JSON.stringify(corpusDoc, null, 2));
  writeFileSync(`${outdir}/labels.json`, JSON.stringify(labels, null, 2));

  const identity = {
    schema: 'anvil.abi-battery-identity.v1',
    mintedAt: new Date().toISOString(),
    sourceSha: gitSha(),
    decisionContract,
    corpusId: EXPERIMENT_CORPUS_ID,
    corpusDigest,
    labelBindingDigest,
    verifierIdentity: EXPERIMENT_VERIFIER_ID,
    labelAuthority: 'STRONG (mechanical construction truth; synthetic-fixture scope)',
    provider: {
      id: provider,
      endpoint: meta.endpoint,
      model: meta.model,
      credentialPath: meta.credentialRef,
      egressBoundary: meta.boundary,
    },
    arms: {
      five_axis: {
        axes: FIVE_AXIS_EXPERIMENT_AXES,
        abiVersion: 'anvil.semantic-observation-abi.v1',
        observationABIDigest: abi5,
        providerProfile: profile5,
      },
      four_axis: {
        axes: FOUR_AXIS_EXPERIMENT_AXES,
        abiVersion: FOUR_AXIS_ABI_ID,
        observationABIDigest: abi4,
        providerProfile: profile4,
      },
    },
    thresholds: { evidenceSufficientFloor: 0.8, keepFull: 0.8, retain: 0.5 },
    repeatCount: 8,
    counts: { traces: entries.length, labels: labels.length },
  };
  writeFileSync(`${outdir}/experiment-identity.json`, JSON.stringify(identity, null, 2));
  console.log(`minted: traces=${entries.length} labels=${labels.length}`);
  console.log(`corpusDigest=${corpusDigest}`);
  console.log(`labelBindingDigest=${labelBindingDigest}`);
  console.log(`profile5=${profile5.providerProfileDigest}`);
  console.log(`profile4=${profile4.providerProfileDigest}`);
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface CallSpec {
  callId: string;
  wave: 'A' | 'D' | 'E' | 'F';
  purpose: 'primary' | 'repeat' | 'axis-order' | 'batch' | 'batch-alt' | 'candidate-order' | 'replay';
  arm: 'five-axis' | 'four-axis';
  traceId: string;
  axes: readonly MappedObservationAxis[];
  axesOrderTag: 'canonical' | 'reversed' | 'es-last';
  batchTag: string;
  repeatIndex: number;
  idMap: Record<string, string> | null;
  request: MappedDecisionRequest;
}

interface LoadedExperiment {
  entries: CorpusEntry[];
  traces: ReplayTrace[];
  labels: SemanticCalibrationLabel[];
  identity: ReturnType<typeof JSON.parse>;
  profiles5: ObservationProfiles;
  profiles4: ObservationProfiles;
}

export function loadExperiment(outdir: string): LoadedExperiment {
  const corpusDoc = JSON.parse(readFileSync(`${outdir}/corpus.json`, 'utf8'));
  const labels = JSON.parse(readFileSync(`${outdir}/labels.json`, 'utf8')) as SemanticCalibrationLabel[];
  const identity = JSON.parse(readFileSync(`${outdir}/experiment-identity.json`, 'utf8'));
  const entries = corpusDoc.entries as CorpusEntry[];
  const traces = entries.map((entry) => entry.trace);
  const profiles5 = profilesFor(
    identity.arms.five_axis.providerProfile.providerProfileDigest,
    identity.arms.five_axis.providerProfile.providerId,
    identity.decisionContract,
  );
  const profiles4 = profilesFor(
    identity.arms.four_axis.providerProfile.providerProfileDigest,
    identity.arms.four_axis.providerProfile.providerId,
    identity.decisionContract,
  );
  return { entries, traces, labels, identity, profiles5, profiles4 };
}

const CONTROLLED_WAVES = new Set(['factorial', 'hardneg']);
const REPEAT_COUNT = 8;
const AXIS_ORDER_VARIANTS: Record<string, (axes: readonly MappedObservationAxis[]) => MappedObservationAxis[]> = {
  canonical: (axes) => [...axes],
  reversed: (axes) => [...axes].reverse(),
  'es-last': (axes) => [...axes.filter((a) => a !== 'evidence_sufficient'), 'evidence_sufficient'],
};

export async function planCalls(exp: LoadedExperiment): Promise<CallSpec[]> {
  const specs: CallSpec[] = [];
  const requestCache = new Map<string, Promise<MappedDecisionRequest>>();
  const canonicalRequest = (trace: ReplayTrace, profiles: ObservationProfiles, key: string) => {
    if (!requestCache.has(key)) {
      requestCache.set(key, captureCanonicalRequest(trace, profiles));
    }
    return requestCache.get(key)!;
  };

  const arms = [
    { arm: 'five-axis' as const, axes: FIVE_AXIS_EXPERIMENT_AXES, profiles: exp.profiles5 },
    { arm: 'four-axis' as const, axes: FOUR_AXIS_EXPERIMENT_AXES, profiles: exp.profiles4 },
  ];

  const controlled = exp.entries.filter((entry) => CONTROLLED_WAVES.has(entry.spec.wave));

  // Wave A primary + Wave F replay: every frozen trace, both arms.
  for (const entry of exp.entries) {
    for (const { arm, axes, profiles } of arms) {
      const request = await canonicalRequest(entry.trace, profiles, `${entry.trace.trace_id}:${arm}`);
      specs.push({
        callId: `primary/${entry.trace.trace_id}/${arm}`,
        wave: 'A', purpose: 'primary', arm,
        traceId: entry.trace.trace_id, axes,
        axesOrderTag: 'canonical', batchTag: 'per-trace', repeatIndex: 0,
        idMap: null, request,
      });
      specs.push({
        callId: `replay/${entry.trace.trace_id}/${arm}`,
        wave: 'F', purpose: 'replay', arm,
        traceId: entry.trace.trace_id, axes,
        axesOrderTag: 'canonical', batchTag: 'per-trace', repeatIndex: 0,
        idMap: null, request,
      });
    }
  }

  // Wave F repeats on the controlled subset only (bounded cost).
  for (const entry of controlled) {
    for (const { arm, axes, profiles } of arms) {
      const request = await canonicalRequest(entry.trace, profiles, `${entry.trace.trace_id}:${arm}`);
      for (let i = 0; i < REPEAT_COUNT; i++) {
        specs.push({
          callId: `repeat/${entry.trace.trace_id}/${arm}/${i}`,
          wave: 'F', purpose: 'repeat', arm,
          traceId: entry.trace.trace_id, axes,
          axesOrderTag: 'canonical', batchTag: 'per-trace', repeatIndex: i,
          idMap: null, request,
        });
      }
    }
  }

  // Question-order variants on the controlled subset (five-axis arm).
  for (const entry of controlled) {
    for (const tag of ['reversed', 'es-last'] as const) {
      const axes = AXIS_ORDER_VARIANTS[tag](FIVE_AXIS_EXPERIMENT_AXES);
      const request = await canonicalRequest(entry.trace, exp.profiles5, `${entry.trace.trace_id}:five-axis`);
      specs.push({
        callId: `axorder/${entry.trace.trace_id}/${tag}`,
        wave: 'F', purpose: 'axis-order', arm: 'five-axis',
        traceId: entry.trace.trace_id, axes,
        axesOrderTag: tag, batchTag: 'per-trace', repeatIndex: 0,
        idMap: null, request,
      });
    }
  }

  // Batch composition + candidate-order on the controlled subset.
  const controlledTraces = controlled.map((entry) => entry.trace);
  const batchSize = 8;
  const layouts: { tag: string; groups: ReplayTrace[][] }[] = [
    { tag: 'batch', groups: [] },
    { tag: 'batch-alt', groups: [] },
  ];
  for (let i = 0; i < controlledTraces.length; i += batchSize) {
    layouts[0].groups.push(controlledTraces.slice(i, i + batchSize));
  }
  const stride = Math.ceil(controlledTraces.length / Math.ceil(controlledTraces.length / batchSize));
  const altOrder = Array.from({ length: controlledTraces.length }, (_, i) =>
    controlledTraces[(i * stride) % controlledTraces.length]);
  for (let i = 0; i < altOrder.length; i += batchSize) {
    layouts[1].groups.push(altOrder.slice(i, i + batchSize));
  }

  for (const layout of layouts) {
    for (let g = 0; g < layout.groups.length; g++) {
      const batchId = `${layout.tag}-${String(g).padStart(2, '0')}`;
      const merged = mergedTrace(batchId, layout.groups[g]);
      for (const { arm, axes, profiles } of arms) {
        const request = await canonicalRequest(merged, profiles, `${batchId}:${arm}`);
        specs.push({
          callId: `${layout.tag}/${batchId}/${arm}`,
          wave: 'F', purpose: layout.tag === 'batch' ? 'batch' : 'batch-alt', arm,
          traceId: batchId, axes,
          axesOrderTag: 'canonical', batchTag: batchId, repeatIndex: 0,
          idMap: null, request,
        });
      }
      // Candidate-order permutations on the merged batch (five-axis arm).
      // Each permutation gets a distinct trace_id so request_id stays unique;
      // orders must cover every index (a non-coprime stride duplicates ids).
      for (const perm of ['revpos', 'oddsfirst'] as const) {
        const n = merged.candidates.length;
        const order = perm === 'revpos'
          ? Array.from({ length: n }, (_, i) => n - 1 - i)
          : [
              ...Array.from({ length: n }, (_, i) => i).filter((i) => i % 2 === 1),
              ...Array.from({ length: n }, (_, i) => i).filter((i) => i % 2 === 0),
            ];
        const newIds = order.map((sourceIndex) => `cand-p${String(sourceIndex).padStart(2, '0')}-${batchId}`);
        const { trace: permutedTrace, idMap } = permuteCandidateIds(merged, newIds);
        const permuted = { ...permutedTrace, trace_id: `${batchId}-perm-${perm}` };
        const request = await canonicalRequest(permuted, exp.profiles5, `${batchId}:perm-${perm}`);
        specs.push({
          callId: `candorder/${batchId}/${perm}/five-axis`,
          wave: 'F', purpose: 'candidate-order', arm: 'five-axis',
          traceId: batchId, axes: FIVE_AXIS_EXPERIMENT_AXES,
          axesOrderTag: 'canonical', batchTag: batchId, repeatIndex: 0,
          idMap, request,
        });
      }
    }
  }

  return specs;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

interface CallRecord extends LiveCallResult {
  callId: string;
  wave: string;
  purpose: string;
  arm: string;
  traceId: string;
  requestId: string;
  provider: BatteryProvider;
  axes: readonly string[];
  axesOrderTag: string;
  batchTag: string;
  repeatIndex: number;
  idMap: Record<string, string> | null;
  executedAt: string;
}

function completedCallIds(outdir: string): Set<string> {
  const path = `${outdir}/calls.jsonl`;
  const done = new Set<string>();
  if (!existsSync(path)) return done;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as CallRecord;
      if (record.ok) done.add(record.callId);
    } catch { /* tolerate partial tail */ }
  }
  return done;
}

export async function run(outdir: string, phaseFilter?: string, provider: BatteryProvider = 'jev'): Promise<void> {
  const exp = loadExperiment(outdir);
  const apiKey = provider === 'mercury' ? loadMercuryBearer() : loadApiKey();
  const execute = provider === 'mercury' ? executeMercuryAxisCall : executeLiveAxisCall;
  const model = provider === 'mercury' ? MERCURY_MODEL : JEV_MODEL;
  const all = await planCalls(exp);
  const PERMUTE_PURPOSES = ['axis-order', 'batch', 'batch-alt', 'candidate-order'];
  const wanted = !phaseFilter || phaseFilter === 'all'
    ? all
    : all.filter((spec) =>
        phaseFilter === 'permute'
          ? PERMUTE_PURPOSES.includes(spec.purpose)
          : spec.purpose === phaseFilter);
  const done = completedCallIds(outdir);
  const pending = wanted.filter((spec) => !done.has(spec.callId));
  console.log(`planned=${wanted.length} done=${done.size} pending=${pending.length}`);

  const CONCURRENCY = 6;
  let cursor = 0;
  let completed = 0;
  const logPath = `${outdir}/calls.jsonl`;

  async function worker(): Promise<void> {
    while (cursor < pending.length) {
      const spec = pending[cursor++];
      const result = await execute(spec.request, model, spec.axes, apiKey);
      const record: CallRecord = {
        ...result,
        responseText: result.responseText,
        callId: spec.callId,
        wave: spec.wave,
        purpose: spec.purpose,
        arm: spec.arm,
        traceId: spec.traceId,
        requestId: spec.request.request_id,
        provider,
        axes: spec.axes,
        axesOrderTag: spec.axesOrderTag,
        batchTag: spec.batchTag,
        repeatIndex: spec.repeatIndex,
        idMap: spec.idMap,
        executedAt: new Date().toISOString(),
      };
      appendFileSync(logPath, JSON.stringify(record) + '\n');
      completed += 1;
      if (completed % 25 === 0 || !result.ok) {
        console.log(`[${completed}/${pending.length}] ${spec.callId} ok=${result.ok} status=${result.httpStatus} latency=${result.latencyMs}ms${result.ok ? '' : ` err=${result.errorCode}`}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`run complete: ${completed} calls appended`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

import { pathToFileURL } from 'node:url';

const invokedAsMain =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsMain) {
  const [cmd, outdir, phaseOrProvider, providerArg] = process.argv.slice(2);
  if (!cmd || !outdir) {
    console.error('usage: tsx tools/abi-battery/battery.ts <mint|run|report> <outdir> [phase] [provider]');
    process.exit(2);
  }
  const provider: BatteryProvider =
    providerArg === 'mercury' || phaseOrProvider === 'mercury' ? 'mercury'
    : providerArg === 'jev' || phaseOrProvider === 'jev' ? 'jev'
    : 'jev';
  const phase = providerArg === undefined && (phaseOrProvider === 'jev' || phaseOrProvider === 'mercury')
    ? undefined
    : phaseOrProvider;
  if (cmd === 'mint') {
    await mint(outdir, provider);
  } else if (cmd === 'run') {
    await run(outdir, phase, provider);
  } else if (cmd === 'report') {
    const { report } = await import('./report.js');
    await report(outdir, phaseOrProvider);
  } else {
    console.error(`unknown command ${cmd}`);
    process.exit(2);
  }
}
