// report.ts — computes every battery metric from calls.jsonl + frozen
// corpus/labels and writes report.json + REPORT.md.
//
// Canonical path (five-axis arm): ProviderShadowReplayCompiler over recorded
// live observations -> CalibrationEvidenceCompiler -> real build artifact.
// Four-axis arm: experiment-scoped isotonic analysis (canonical compiler is
// five-axis-bound by design — recorded as an architecture finding, not a
// defect to patch around).

import { readFileSync, writeFileSync } from 'node:fs';
import { loadExperiment, type CallSpec } from './battery.js';
import type { CorpusEntry } from './experiment-corpus.js';
import { casForTraces } from './requests.js';
import { compareSharedAxisObservations, FOUR_AXIS_EXPERIMENT_AXES, type AxisExperimentObservation } from '../../src/lab/semantic-abi-experiment.js';
import { areaUnderRocCurve, averagePrecisionScore } from '../../src/lab/ranking-metrics.js';
import {
  brierScore,
  expectedCalibrationError,
  negativeLogLikelihood,
  selectiveRiskCoverage,
  type BinaryCalibrationSample,
} from '../../src/lab/calibration-metrics.js';
import { fitIsotonicCalibration, applyIsotonicCalibration } from '../../src/lab/isotonic-calibrator.js';
import { splitCampaignCorpus } from '../../src/lab/campaign-corpus.js';
import { ProviderShadowReplayCompiler } from '../../src/lab/provider-shadow-replay.js';
import { CalibrationEvidenceCompiler } from '../../src/lab/calibration-evidence-compiler.js';
import { compileContextRetentionProgram } from '../../src/lab/semantic-program.js';
import { sha256Digest } from '../../src/lab/recovery.js';
import type { SemanticReplayPrediction } from '../../src/lab/calibration-replay.js';
import type { SemanticCalibrationLabel } from '../../src/lab/semantic-label.js';
import type { ReplayTrace } from '../../src/lab/replay.js';
import type { Digest256 } from '../../src/lab/identity.js';
import {
  MAPPED_DECISION_RESPONSE_SCHEMA,
  MAPPED_OBSERVATION_AXES,
  type MappedObservationAxis,
} from '../../src/lab/types.js';

interface StoredRecord {
  callId: string;
  wave: string;
  purpose: string;
  arm: string;
  traceId: string;
  requestId: string;
  axes: string[];
  axesOrderTag: string;
  batchTag: string;
  repeatIndex: number;
  idMap: Record<string, string> | null;
  ok: boolean;
  observations: readonly AxisExperimentObservation[] | null;
  metadata: {
    requested_model: string;
    effective_model: string;
    input_tokens: number | null;
    output_tokens: number | null;
    cost_usd: null;
  } | null;
  httpStatus: number | null;
  latencyMs: number;
  attempts: number;
  requestDigest: string;
  payloadDigest: string;
  payloadBytes: number;
  questionCount: number;
  responseDigest: string | null;
  errorCode: string | null;
  executedAt: string;
}

function loadCalls(outdir: string): StoredRecord[] {
  return readFileSync(`${outdir}/calls.jsonl`, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as StoredRecord);
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? NaN : values.reduce((a, b) => a + b, 0) / values.length;
}
function sd(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}
function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Per-candidate axis probability extraction. candidateId is mapped back to
// the corpus candidate through permutations via record.idMap (newId->origId).
function probsByCandidate(record: StoredRecord): Map<string, Partial<Record<MappedObservationAxis, number>>> {
  const out = new Map<string, Partial<Record<MappedObservationAxis, number>>>();
  if (!record.ok || !record.observations) return out;
  for (const obs of record.observations) {
    const original = record.idMap?.[obs.candidateId] ?? obs.candidateId;
    out.set(original, obs.values);
  }
  return out;
}

function metricBundle(samples: readonly BinaryCalibrationSample[]) {
  if (samples.length === 0) return null;
  const pos = samples.filter((s) => s.outcome === 1);
  const neg = samples.filter((s) => s.outcome === 0);
  return {
    n: samples.length,
    positives: pos.length,
    negatives: neg.length,
    auroc: areaUnderRocCurve(samples),
    auprc: averagePrecisionScore(samples),
    brier: brierScore(samples),
    ece10: expectedCalibrationError(samples, 10),
    nll: negativeLogLikelihood(samples),
    positiveMeanProbability: pos.length ? mean(pos.map((s) => s.probability)) : null,
    negativeMeanProbability: neg.length ? mean(neg.map((s) => s.probability)) : null,
  };
}

export async function report(outdir: string, compareOutdir?: string): Promise<void> {
  const exp = loadExperiment(outdir);
  const calls = loadCalls(outdir);
  const byCallId = new Map(calls.map((record) => [record.callId, record]));
  const entries = exp.entries;
  const candById = new Map<string, CorpusEntry>();
  for (const entry of entries) {
    candById.set(entry.trace.candidates[0].candidate_id, entry);
  }

  // ------------------------------------------------------------------
  // Wave A: paired A/B on primary pass
  // ------------------------------------------------------------------
  const primary5 = calls.filter((r) => r.purpose === 'primary' && r.arm === 'five-axis' && r.ok);
  const primary4 = calls.filter((r) => r.purpose === 'primary' && r.arm === 'four-axis' && r.ok);
  const failedCalls = calls.filter((r) => !r.ok);
  const malformed = calls.filter((r) => r.errorCode === 'malformed_response');
  const retried = calls.filter((r) => r.attempts > 1);
  const modelIds = new Set(calls.filter((r) => r.ok).map((r) => r.metadata!.effective_model));

  const fiveObs: AxisExperimentObservation[] = [];
  const fourObs: AxisExperimentObservation[] = [];
  for (const record of primary5) {
    for (const [cand, values] of probsByCandidate(record)) {
      fiveObs.push({ candidateId: cand, values });
    }
  }
  for (const record of primary4) {
    for (const [cand, values] of probsByCandidate(record)) {
      fourObs.push({ candidateId: cand, values });
    }
  }
  const deltas = compareSharedAxisObservations(fiveObs, fourObs);
  const deltaByAxis = Object.fromEntries(FOUR_AXIS_EXPERIMENT_AXES.map((axis) => [
    axis,
    deltas.filter((d) => d.axis === axis).map((d) => d.absoluteDelta),
  ]));
  const waveA = {
    pairs: fiveObs.length,
    perAxis: Object.fromEntries(FOUR_AXIS_EXPERIMENT_AXES.map((axis) => {
      const ds = deltaByAxis[axis] as number[];
      return [axis, {
        meanAbsDelta: mean(ds),
        maxAbsDelta: Math.max(...ds),
        fracDeltaGt005: ds.filter((d) => d > 0.05).length / ds.length,
        fracDeltaGt010: ds.filter((d) => d > 0.10).length / ds.length,
      }];
    })),
    tokens: {
      five_axis: {
        input: primary5.map((r) => r.metadata?.input_tokens ?? NaN),
        output: primary5.map((r) => r.metadata?.output_tokens ?? NaN),
      },
      four_axis: {
        input: primary4.map((r) => r.metadata?.input_tokens ?? NaN),
        output: primary4.map((r) => r.metadata?.output_tokens ?? NaN),
      },
    },
    latencyMs: {
      five_axis: primary5.map((r) => r.latencyMs),
      four_axis: primary4.map((r) => r.latencyMs),
    },
    questionCount: { five_axis: primary5[0]?.questionCount ?? 0, four_axis: primary4[0]?.questionCount ?? 0 },
    malformedResponses: malformed.length,
    failedCalls: failedCalls.length,
    retriedCalls: retried.length,
    effectiveModels: [...modelIds],
  };

  // ------------------------------------------------------------------
  // Wave B: threshold-free metrics on primary pass
  // ------------------------------------------------------------------
  function samplesFor(arm: 'five-axis' | 'four-axis', axis: MappedObservationAxis, subset?: (entry: CorpusEntry) => boolean): BinaryCalibrationSample[] {
    const records = calls.filter((r) => r.purpose === 'primary' && r.arm === arm && r.ok);
    const samples: BinaryCalibrationSample[] = [];
    for (const record of records) {
      for (const [cand, values] of probsByCandidate(record)) {
        const entry = candById.get(cand);
        if (!entry) continue;
        if (subset && !subset(entry)) continue;
        const p = values[axis];
        if (typeof p !== 'number') continue;
        samples.push({ probability: p, outcome: entry.targets[axis] });
      }
    }
    return samples;
  }

  const waveB: Record<string, unknown> = {};
  for (const axis of MAPPED_OBSERVATION_AXES) {
    waveB[axis] = {
      five_axis: metricBundle(samplesFor('five-axis', axis)),
      four_axis: FOUR_AXIS_EXPERIMENT_AXES.includes(axis as never)
        ? metricBundle(samplesFor('four-axis', axis))
        : 'not-modeled',
    };
  }

  // ------------------------------------------------------------------
  // Wave C: evidence_sufficient calibration (train/holdout)
  // ------------------------------------------------------------------
  const traces = exp.traces;
  const { training, holdout } = splitCampaignCorpus(traces);
  const sourceSet = (ts: ReplayTrace[]) => new Set(ts.flatMap((t) => t.candidates.map((c) => c.recovery.source_digest)));
  const trainSources = sourceSet(training);
  const holdoutSources = sourceSet(holdout);
  const entryBySource = new Map(entries.map((e) => [e.trace.candidates[0].recovery.source_digest, e]));

  function probBySource(arm: 'five-axis' | 'four-axis', axis: MappedObservationAxis): Map<string, number> {
    const out = new Map<string, number>();
    for (const record of calls.filter((r) => r.purpose === 'primary' && r.arm === arm && r.ok)) {
      for (const [cand, values] of probsByCandidate(record)) {
        const entry = candById.get(cand);
        const p = values[axis];
        if (entry && typeof p === 'number') out.set(entry.trace.candidates[0].recovery.source_digest, p);
      }
    }
    return out;
  }

  const waveC: Record<string, unknown> = {};
  for (const arm of ['five-axis', 'four-axis'] as const) {
    const prob = probBySource(arm, 'evidence_sufficient');
    const trainSamples = exp.labels
      .filter((l) => l.predicateId === 'evidence_sufficient' && trainSources.has(l.sourceDigest))
      .map((l) => ({ labelId: l.labelId, sourceDigest: l.sourceDigest, predicateId: 'evidence_sufficient' as const, executionProfileDigest: 'x' as Digest256, observationDigest: 'sha256:' + '0'.repeat(64) as Digest256, probability: prob.get(l.sourceDigest)!, target: l.target }))
      .filter((s) => typeof s.probability === 'number');
    const holdoutSamples = exp.labels
      .filter((l) => l.predicateId === 'evidence_sufficient' && holdoutSources.has(l.sourceDigest))
      .map((l) => ({ probability: prob.get(l.sourceDigest)!, outcome: l.target }))
      .filter((s) => typeof s.probability === 'number');

    let calibrated: BinaryCalibrationSample[] = [];
    let model: ReturnType<typeof fitIsotonicCalibration> | null = null;
    try {
      model = fitIsotonicCalibration(trainSamples);
      calibrated = holdoutSamples.map((s) => ({
        probability: applyIsotonicCalibration(model!, s.probability),
        outcome: s.outcome,
      }));
    } catch (error) {
      calibrated = [];
    }

    const floor = 0.8;
    const gate = (samples: readonly BinaryCalibrationSample[]) => {
      const selected = samples.filter((s) => s.probability >= floor);
      const leaks = selected.filter((s) => s.outcome === 0).length;
      return { selected: selected.length, leaks, coverage: samples.length ? selected.length / samples.length : 0 };
    };

    const trainMetrics = metricBundle(trainSamples.map((s) => ({ probability: s.probability, outcome: s.target })));

    waveC[arm] = {
      train: { n: trainSamples.length, ...trainMetrics },
      holdout_raw: { n: holdoutSamples.length, ...metricBundle(holdoutSamples) },
      holdout_calibrated: calibrated.length ? { n: calibrated.length, ...metricBundle(calibrated) } : 'isotonic-fit-failed',
      es_gate_raw: gate(holdoutSamples),
      es_gate_calibrated: calibrated.length ? gate(calibrated) : null,
      isotonicBlocks: model ? model.blocks.length : null,
      split: { training: training.length, holdout: holdout.length },
    };
  }

  // Canonical path for the five-axis arm: recorded provider -> shadow replay
  // -> calibration evidence compiler.
  const canonical: Record<string, unknown> = {};
  try {
    const recorded = new Map<string, StoredRecord>();
    for (const record of primary5) recorded.set(record.requestId, record);
    const recordedProvider = (request: { request_id: string }) => {
      const record = recorded.get(request.request_id);
      if (!record || !record.observations) {
        throw new Error(`no recorded live observation for ${request.request_id}`);
      }
      return {
        schema: MAPPED_DECISION_RESPONSE_SCHEMA,
        request_id: request.request_id,
        observations: record.observations.map((obs) => ({
          candidate_id: obs.candidateId,
          evidence_sufficient: { noul: obs.values.evidence_sufficient ?? 0 },
          still_needed: { noul: obs.values.still_needed ?? 0 },
          full_content_needed: { noul: obs.values.full_content_needed ?? 0 },
          unresolved_evidence: { noul: obs.values.unresolved_evidence ?? 0 },
          recoverable: { noul: obs.values.recoverable ?? 0 },
        })),
      };
    };
    const compiler = new ProviderShadowReplayCompiler();
    const thresholds = exp.identity.thresholds;
    const profile5 = exp.identity.arms.five_axis.providerProfile;
    async function replaySplit(splitTraces: ReplayTrace[], splitLabels: SemanticCalibrationLabel[]) {
      return compiler.compile({
        providerProfile: profile5 as never,
        observationProfiles: exp.profiles5,
        provider: recordedProvider as never,
        traces: splitTraces,
        labels: splitLabels,
        cas: casForTraces(splitTraces),
        thresholds,
      });
    }
    const trainingLabels = exp.labels.filter((l) => trainSources.has(l.sourceDigest));
    const holdoutLabels = exp.labels.filter((l) => holdoutSources.has(l.sourceDigest));
    const trainArtifact = await replaySplit(training, trainingLabels);
    const holdoutArtifact = await replaySplit(holdout, holdoutLabels);
    const program = compileContextRetentionProgram(exp.profiles5.decision_contract);
    const samplingPolicyDigest = sha256Digest(JSON.stringify({
      schema: 'anvil.sampling-policy.v1',
      rule: 'deterministic digest-parity split over abi-battery corpus v1; live jev-1.13.0 primary pass',
    }));
    const labelAuthorityPolicyDigest = sha256Digest(JSON.stringify({
      schema: 'anvil.label-authority-policy.v1',
      rule: 'STRONG mechanical construction-truth labels only; synthetic-fixture scope declared',
    }));
    const build = new CalibrationEvidenceCompiler().compile({
      providerProfile: profile5 as never,
      decisionContractDigest: exp.identity.decisionContract.digest as Digest256,
      compiledProgramDigest: program.programDigest as Digest256,
      samplingPolicyDigest: samplingPolicyDigest as Digest256,
      labelAuthorityPolicyDigest: labelAuthorityPolicyDigest as Digest256,
      labelBindingDigest: exp.identity.labelBindingDigest as Digest256,
      trainingLabels,
      trainingPredictions: trainArtifact.predictions as readonly SemanticReplayPrediction[],
      holdoutLabels,
      holdoutPredictions: holdoutArtifact.predictions as readonly SemanticReplayPrediction[],
      confidenceFloor: 0.8,
      eceBins: 10,
    });
    canonical.five_axis = {
      trainReplayDigest: trainArtifact.replayDigest,
      holdoutReplayDigest: holdoutArtifact.replayDigest,
      buildDigest: build.buildDigest,
      calibrationArtifactDigest: build.calibrationArtifact.artifactDigest,
      holdoutMetrics: build.holdoutMetrics,
      predictions: { train: trainArtifact.predictions.length, holdout: holdoutArtifact.predictions.length },
    };
  } catch (error) {
    canonical.five_axis = { error: String(error) };
  }
  canonical.four_axis = 'canonical compile requires all five registered predicates — experiment-scoped isotonic reported in waveC.four_axis (architecture finding)';

  // ------------------------------------------------------------------
  // Wave D: factorial unresolved_evidence analysis
  // ------------------------------------------------------------------
  const factorial = entries.filter((e) => e.spec.wave === 'factorial');
  function meanP(arm: 'five-axis' | 'four-axis', axis: MappedObservationAxis, pred: (entry: CorpusEntry) => boolean): { mean: number; sd: number; n: number } {
    const probs: number[] = [];
    for (const record of calls.filter((r) => (r.purpose === 'primary' || r.purpose === 'repeat') && r.arm === arm && r.ok)) {
      for (const [cand, values] of probsByCandidate(record)) {
        const entry = candById.get(cand);
        const p = values[axis];
        if (entry && pred(entry) && typeof p === 'number') probs.push(p);
      }
    }
    return { mean: mean(probs), sd: sd(probs), n: probs.length };
  }

  const cells: Record<string, { mean: number; sd: number; n: number; labelMean: number }> = {};
  for (const complete of [true, false]) {
    for (const contra of [true, false]) {
      const pred = (e: CorpusEntry) => e.spec.wave === 'factorial' && e.spec.unresolvedKind === null &&
        (e.spec.placement === 'head') === complete && e.spec.contradiction === contra;
      const res = meanP('five-axis', 'unresolved_evidence', pred);
      const labelMean = mean(entries.filter(pred).map((e) => e.targets.unresolved_evidence));
      cells[`complete=${complete}|contradiction=${contra}`] = { ...res, labelMean };
    }
  }
  const kindRows: Record<string, { mean: number; sd: number; n: number; labelMean: number }> = {};
  for (const kind of ['warning', 'dependency', 'verification', 'resolved-historical'] as const) {
    const pred = (e: CorpusEntry) => e.spec.unresolvedKind === kind;
    const res = meanP('five-axis', 'unresolved_evidence', pred);
    const labelMean = mean(entries.filter(pred).map((e) => e.targets.unresolved_evidence));
    kindRows[kind] = { ...res, labelMean };
  }
  const waveD = { cells, kinds: kindRows, fourAxisCells: Object.fromEntries(
    Object.keys(cells).map((cell) => {
      const [c, k] = cell.split('|').map((part) => part.split('=')[1] === 'true');
      return [cell, meanP('four-axis', 'unresolved_evidence', (e) =>
        e.spec.wave === 'factorial' && e.spec.unresolvedKind === null &&
        (e.spec.placement === 'head') === c && e.spec.contradiction === k)];
    }),
  ) };

  // ------------------------------------------------------------------
  // Wave E: still_needed hard negatives
  // ------------------------------------------------------------------
  const hardneg = entries.filter((e) => e.spec.wave === 'hardneg');
  const stillNeededSet = (e: CorpusEntry) => e.spec.wave === 'hardneg' || e.targets.still_needed === 1;
  const waveE = {
    five_axis: metricBundle(samplesFor('five-axis', 'still_needed', stillNeededSet)),
    four_axis: metricBundle(samplesFor('four-axis', 'still_needed', stillNeededSet)),
    perKind: Object.fromEntries(
      [...new Set(hardneg.map((e) => e.spec.obsoleteKind ?? 'none'))].map((kind) => [
        kind,
        {
          five: meanP('five-axis', 'still_needed', (e) => e.spec.obsoleteKind === kind),
          four: meanP('four-axis', 'still_needed', (e) => e.spec.obsoleteKind === kind),
          labelMean: mean(entries.filter((e) => e.spec.obsoleteKind === kind).map((e) => e.targets.still_needed)),
        },
      ]),
    ),
    negativesInSet: hardneg.length,
  };

  // ------------------------------------------------------------------
  // Wave F: repeatability and invariance
  // ------------------------------------------------------------------
  const controlled = entries.filter((e) => ['factorial', 'hardneg'].includes(e.spec.wave));
  const repeatability: Record<string, unknown> = {};
  for (const arm of ['five-axis', 'four-axis'] as const) {
    const perAxisDevs: Record<string, { sds: number[]; maxDevs: number[] }> = {};
    for (const axis of (arm === 'five-axis' ? MAPPED_OBSERVATION_AXES : FOUR_AXIS_EXPERIMENT_AXES)) {
      const sds: number[] = [];
      const maxDevs: number[] = [];
      for (const entry of controlled) {
        const cand = entry.trace.candidates[0].candidate_id;
        const probs: number[] = [];
        for (let i = 0; i < 8; i++) {
          const record = byCallId.get(`repeat/${entry.trace.trace_id}/${arm}/${i}`);
          if (!record) continue;
          const p = probsByCandidate(record).get(cand)?.[axis];
          if (typeof p === 'number') probs.push(p);
        }
        if (probs.length >= 2) {
          sds.push(sd(probs));
          maxDevs.push(Math.max(...probs) - Math.min(...probs));
        }
      }
      perAxisDevs[axis] = { sds, maxDevs };
    }
    repeatability[arm] = Object.fromEntries(Object.entries(perAxisDevs).map(([axis, v]) => [
      axis,
      {
        meanSd: mean(v.sds),
        maxSd: Math.max(...v.sds, 0),
        meanMaxDev: mean(v.maxDevs),
        maxDev: Math.max(...v.maxDevs, 0),
        candidatesMeasured: v.sds.length,
      },
    ]));
  }

  // Axis-order sensitivity: |P(order) - P(canonical primary)| per axis.
  const axisOrder: Record<string, unknown> = {};
  for (const tag of ['reversed', 'es-last']) {
    const perAxis: Record<string, number[]> = {};
    for (const entry of controlled) {
      const cand = entry.trace.candidates[0].candidate_id;
      const variant = byCallId.get(`axorder/${entry.trace.trace_id}/${tag}`);
      const primary = byCallId.get(`primary/${entry.trace.trace_id}/five-axis`);
      if (!variant || !primary) continue;
      for (const axis of MAPPED_OBSERVATION_AXES) {
        const pv = probsByCandidate(variant).get(cand)?.[axis];
        const pp = probsByCandidate(primary).get(cand)?.[axis];
        if (typeof pv === 'number' && typeof pp === 'number') {
          (perAxis[axis] ??= []).push(Math.abs(pv - pp));
        }
      }
    }
    axisOrder[tag] = Object.fromEntries(Object.entries(perAxis).map(([axis, ds]) => [
      axis, { meanAbsDelta: mean(ds), maxAbsDelta: Math.max(...ds, 0), n: ds.length },
    ]));
  }

  // Batch sensitivity: |P(batched) - P(per-trace)| per axis.
  const batchSensitivity: Record<string, unknown> = {};
  for (const arm of ['five-axis', 'four-axis'] as const) {
    for (const purpose of ['batch', 'batch-alt']) {
      const perAxis: Record<string, number[]> = {};
      for (const record of calls.filter((r) => r.purpose === purpose && r.arm === arm && r.ok)) {
        for (const [cand, values] of probsByCandidate(record)) {
          const entry = candById.get(cand);
          if (!entry) continue;
          const primary = byCallId.get(`primary/${entry.trace.trace_id}/${arm}`);
          if (!primary) continue;
          for (const axis of (arm === 'five-axis' ? MAPPED_OBSERVATION_AXES : FOUR_AXIS_EXPERIMENT_AXES)) {
            const pb = values[axis];
            const pp = probsByCandidate(primary).get(cand)?.[axis];
            if (typeof pb === 'number' && typeof pp === 'number') {
              (perAxis[axis] ??= []).push(Math.abs(pb - pp));
            }
          }
        }
      }
      batchSensitivity[`${purpose}:${arm}`] = Object.fromEntries(Object.entries(perAxis).map(([axis, ds]) => [
        axis, { meanAbsDelta: mean(ds), maxAbsDelta: Math.max(...ds, 0), n: ds.length },
      ]));
    }
  }

  // Candidate-order sensitivity: |P(perm position) - P(natural batch)|.
  const candOrder: Record<string, unknown> = {};
  for (const perm of ['revpos', 'oddsfirst']) {
    const perAxis: Record<string, number[]> = {};
    for (const record of calls.filter((r) => r.purpose === 'candidate-order' && r.callId.endsWith(`/${perm}/five-axis`) && r.ok)) {
      const layoutTag = record.traceId.replace(/-\d+$/, '');
      const batchPrimary = byCallId.get(`${layoutTag}/${record.traceId}/five-axis`);
      if (!batchPrimary) continue;
      const baseProbs = probsByCandidate(batchPrimary);
      for (const [origId, values] of probsByCandidate(record)) {
        for (const axis of MAPPED_OBSERVATION_AXES) {
          const pPerm = values[axis];
          const pBase = baseProbs.get(origId)?.[axis];
          if (typeof pPerm === 'number' && typeof pBase === 'number') {
            (perAxis[axis] ??= []).push(Math.abs(pPerm - pBase));
          }
        }
      }
    }
    candOrder[perm] = Object.fromEntries(Object.entries(perAxis).map(([axis, ds]) => [
      axis, { meanAbsDelta: mean(ds), maxAbsDelta: Math.max(...ds, 0), n: ds.length },
    ]));
  }

  // Temporal replay: |P(replay) - P(primary)|.
  const temporal: Record<string, unknown> = {};
  for (const arm of ['five-axis', 'four-axis'] as const) {
    const perAxis: Record<string, number[]> = {};
    for (const entry of exp.entries) {
      const cand = entry.trace.candidates[0].candidate_id;
      const p1 = byCallId.get(`primary/${entry.trace.trace_id}/${arm}`);
      const p2 = byCallId.get(`replay/${entry.trace.trace_id}/${arm}`);
      if (!p1 || !p2) continue;
      for (const axis of (arm === 'five-axis' ? MAPPED_OBSERVATION_AXES : FOUR_AXIS_EXPERIMENT_AXES)) {
        const a = probsByCandidate(p1).get(cand)?.[axis];
        const b = probsByCandidate(p2).get(cand)?.[axis];
        if (typeof a === 'number' && typeof b === 'number') {
          (perAxis[axis] ??= []).push(Math.abs(a - b));
        }
      }
    }
    temporal[arm] = Object.fromEntries(Object.entries(perAxis).map(([axis, ds]) => [
      axis, { meanAbsDelta: mean(ds), maxAbsDelta: Math.max(...ds, 0), n: ds.length },
    ]));
  }

  const waveF = { repeatability, axisOrder, batchSensitivity, candOrder, temporal };

  // ------------------------------------------------------------------
  // Wave G: provider comparison.
  // Route status: gemini-flash via fazm gateway :8877 is BLOCKED by SIEVE
  // ingress attestation (x-sieve-ingress-attestation/signature required;
  // no client-side minting route found — production boundary not bypassed).
  // qwen-ane and mavis have no authorized local runtime. Inception
  // Mercury 2 via the rune gateway :8903 (bearer auth, no ingress
  // requirement) executed the identical frozen corpus under its own
  // ProviderExecutionProfile — compared below when compareOutdir is set.
  // ------------------------------------------------------------------
  let waveG: Record<string, unknown> = {
    status: 'BLOCKED',
    providers: {
      'gemini-flash-fazm-gateway': {
        available: false,
        evidence: 'SIEVE ingress attestation rejected (sieve_attestation_missing) on POST /v1/chat/completions @127.0.0.1:8877; required headers x-sieve-ingress-attestation/x-sieve-ingress-signature are minted by a proposal handshake with no client-accessible mint route; boundary not bypassed',
      },
      'qwen-ane': {
        available: false,
        evidence: 'no qwen binary on PATH or ~/.local/bin; no .mlpackage qwen artifact under ~/ANVIL; LOCAL_QWEN_MAVIS_ADAPTER_SPEC.md is a design spec, not a runtime; no local inference endpoint listening',
      },
      mavis: {
        available: false,
        evidence: 'tools/mavis-harness is a bootstrap/claim/supervise binary for the Mavis Microcortex contract — it has no questions/answers semantic interface; no mavis model runtime found',
      },
    },
    conclusion: 'provider comparison could not run; JEV findings are provider-specific until a second provider execution profile exists',
  };

  if (compareOutdir) {
    const expB = loadExperiment(compareOutdir);
    const callsB = loadCalls(compareOutdir);
    const byCallIdB = new Map(callsB.map((record) => [record.callId, record]));
    if (expB.identity.corpusDigest !== exp.identity.corpusDigest) {
      throw new Error(`compareOutdir corpus digest mismatch: ${expB.identity.corpusDigest} != ${exp.identity.corpusDigest}`);
    }
    const okB = callsB.filter((r) => r.ok);
    const primary5B = callsB.filter((r) => r.purpose === 'primary' && r.arm === 'five-axis' && r.ok);
    const primary4B = callsB.filter((r) => r.purpose === 'primary' && r.arm === 'four-axis' && r.ok);

    // B Wave A: paired shared-axis deltas five vs four arm.
    const p5ByTrace = new Map(primary5B.map((r) => [r.traceId, r]));
    const deltasB: Record<string, number[]> = {};
    for (const record of primary4B) {
      const base = p5ByTrace.get(record.traceId);
      if (!base) continue;
      const a = probsByCandidate(base);
      const b = probsByCandidate(record);
      for (const [cand, vb] of b) {
        const va = a.get(cand);
        if (!va) continue;
        for (const axis of FOUR_AXIS_EXPERIMENT_AXES) {
          const x = va[axis]; const y = vb[axis];
          if (typeof x === 'number' && typeof y === 'number') {
            (deltasB[axis] ??= []).push(Math.abs(x - y));
          }
        }
      }
    }
    const waveA_B = Object.fromEntries(Object.entries(deltasB).map(([axis, ds]) => [
      axis, { meanAbsDelta: mean(ds), maxAbsDelta: Math.max(...ds, 0), n: ds.length },
    ]));

    // B Wave B: per-axis threshold-free metrics on primary (same corpus labels).
    const samplesB = (arm: 'five-axis' | 'four-axis', axis: MappedObservationAxis): BinaryCalibrationSample[] => {
      const out: BinaryCalibrationSample[] = [];
      for (const record of callsB.filter((r) => r.purpose === 'primary' && r.arm === arm && r.ok)) {
        for (const [cand, values] of probsByCandidate(record)) {
          const entry = candById.get(cand);
          if (!entry) continue;
          const p = values[axis];
          if (typeof p === 'number') out.push({ probability: p, outcome: entry.targets[axis] });
        }
      }
      return out;
    };
    const waveB_B: Record<string, unknown> = {};
    for (const axis of MAPPED_OBSERVATION_AXES) {
      waveB_B[axis] = {
        five_axis: metricBundle(samplesB('five-axis', axis)),
        four_axis: FOUR_AXIS_EXPERIMENT_AXES.includes(axis as never)
          ? metricBundle(samplesB('four-axis', axis))
          : 'not-modeled',
      };
    }

    // B invariance: batch sensitivity, candidate-order, repeatability, temporal.
    const batchB: Record<string, unknown> = {};
    for (const arm of ['five-axis', 'four-axis'] as const) {
      for (const purpose of ['batch', 'batch-alt']) {
        const perAxis: Record<string, number[]> = {};
        for (const record of callsB.filter((r) => r.purpose === purpose && r.arm === arm && r.ok)) {
          for (const [cand, values] of probsByCandidate(record)) {
            const entry = candById.get(cand);
            if (!entry) continue;
            const primary = byCallIdB.get(`primary/${entry.trace.trace_id}/${arm}`);
            if (!primary) continue;
            for (const axis of (arm === 'five-axis' ? MAPPED_OBSERVATION_AXES : FOUR_AXIS_EXPERIMENT_AXES)) {
              const pb = values[axis];
              const pp = probsByCandidate(primary).get(cand)?.[axis];
              if (typeof pb === 'number' && typeof pp === 'number') {
                (perAxis[axis] ??= []).push(Math.abs(pb - pp));
              }
            }
          }
        }
        batchB[`${purpose}:${arm}`] = Object.fromEntries(Object.entries(perAxis).map(([axis, ds]) => [
          axis, { meanAbsDelta: mean(ds), maxAbsDelta: Math.max(...ds, 0), n: ds.length },
        ]));
      }
    }
    const candOrderB: Record<string, unknown> = {};
    for (const perm of ['revpos', 'oddsfirst']) {
      const perAxis: Record<string, number[]> = {};
      for (const record of callsB.filter((r) => r.purpose === 'candidate-order' && r.callId.endsWith(`/${perm}/five-axis`) && r.ok)) {
        const layoutTag = record.traceId.replace(/-\d+$/, '');
        const batchPrimary = byCallIdB.get(`${layoutTag}/${record.traceId}/five-axis`);
        if (!batchPrimary) continue;
        const baseProbs = probsByCandidate(batchPrimary);
        for (const [origId, values] of probsByCandidate(record)) {
          for (const axis of MAPPED_OBSERVATION_AXES) {
            const pPerm = values[axis];
            const pBase = baseProbs.get(origId)?.[axis];
            if (typeof pPerm === 'number' && typeof pBase === 'number') {
              (perAxis[axis] ??= []).push(Math.abs(pPerm - pBase));
            }
          }
        }
      }
      candOrderB[perm] = Object.fromEntries(Object.entries(perAxis).map(([axis, ds]) => [
        axis, { meanAbsDelta: mean(ds), maxAbsDelta: Math.max(...ds, 0), n: ds.length },
      ]));
    }
    const repeatB: Record<string, unknown> = {};
    for (const arm of ['five-axis', 'four-axis'] as const) {
      for (const axis of (arm === 'five-axis' ? MAPPED_OBSERVATION_AXES : FOUR_AXIS_EXPERIMENT_AXES)) {
        const sds: number[] = [];
        for (const entry of controlled) {
          const cand = entry.trace.candidates[0].candidate_id;
          const probs: number[] = [];
          for (let i = 0; i < 8; i++) {
            const record = byCallIdB.get(`repeat/${entry.trace.trace_id}/${arm}/${i}`);
            if (!record) continue;
            const p = probsByCandidate(record).get(cand)?.[axis];
            if (typeof p === 'number') probs.push(p);
          }
          if (probs.length >= 2) sds.push(sd(probs));
        }
        repeatB[`${arm}:${axis}`] = { meanSd: mean(sds), maxSd: Math.max(...sds, 0), n: sds.length };
      }
    }

    waveG = {
      status: 'EXECUTED',
      providerA: {
        id: exp.identity.provider?.id ?? `${exp.identity.provider?.endpoint ?? 'unknown'}/${exp.identity.provider?.model ?? 'unknown'}`,
        profileDigest5: exp.identity.arms.five_axis.providerProfile.providerProfileDigest,
        wireContract: 'systemone-mapped-payload.v0 (provider-internal noul)',
      },
      providerB: {
        id: expB.identity.provider?.id ?? 'unknown',
        endpoint: expB.identity.provider?.endpoint ?? null,
        model: expB.identity.provider?.model ?? null,
        profileDigest5: expB.identity.arms.five_axis.providerProfile.providerProfileDigest,
        profileDigest4: expB.identity.arms.four_axis.providerProfile.providerProfileDigest,
        wireContract: 'openai-chat-completions-json-elicitation.v0 (self-reported probability)',
        calls: {
          total: callsB.length,
          ok: okB.length,
          failed: callsB.length - okB.length,
          malformed: callsB.filter((r) => !r.ok && r.errorCode === 'malformed_response').length,
          retried: callsB.filter((r) => r.attempts > 1).length,
          latencyMs: { mean: mean(callsB.map((r) => r.latencyMs)), median: median(callsB.map((r) => r.latencyMs)) },
          tokensObserved: okB.some((r) => r.metadata?.input_tokens !== null && r.metadata?.input_tokens !== undefined),
        },
      },
      sharedAxisDeltas_B: waveA_B,
      waveB_B,
      invariance_B: {
        batchSensitivity: batchB,
        candidateOrder: candOrderB,
        repeatability: repeatB,
      },
      reference_A: {
        sharedAxisDeltas: waveA.perAxis,
        waveB,
        batchSensitivity: waveF.batchSensitivity,
        candidateOrder: waveF.candOrder,
        repeatability: waveF.repeatability,
        latencyMs: {
          mean: mean(waveA.latencyMs.five_axis),
          median: median(waveA.latencyMs.five_axis),
        },
      },
      note: 'Provider B probabilities are model self-reports under strict-JSON elicitation — a different execution semantic than provider-internal noul. Cross-provider deltas therefore conflate model quality with elicitation semantics; both are recorded as distinct ProviderExecutionProfiles.',
    };
  }

  // ------------------------------------------------------------------
  // Mechanical recovery plane (recovery truth from CAS, not semantics)
  // ------------------------------------------------------------------
  const cas = casForTraces(traces);
  const recoveryTruth = entries.map((entry) => {
    const candidate = entry.trace.candidates[0];
    return {
      traceId: entry.trace.trace_id,
      candidateId: candidate.candidate_id,
      mechanicalVerifyOk: cas.verifyTool(candidate.recovery, candidate.stdout, candidate.stderr, candidate.exit_status).ok,
      semanticRecoverableLabel: entry.targets.recoverable,
    };
  });

  // ------------------------------------------------------------------
  // Write artifacts
  // ------------------------------------------------------------------
  const reportDoc = {
    schema: 'anvil.abi-battery-report.v1',
    generatedAt: new Date().toISOString(),
    evidenceClass: 'live-provider-on-synthetic-fixture-corpus',
    sourceSha: exp.identity.sourceSha,
    corpusDigest: exp.identity.corpusDigest,
    labelBindingDigest: exp.identity.labelBindingDigest,
    callCount: calls.length,
    callCountOk: calls.filter((r) => r.ok).length,
    waveA: {
      ...waveA,
      tokens: {
        five_axis: {
          inputMean: mean(waveA.tokens.five_axis.input), inputTotal: waveA.tokens.five_axis.input.reduce((a, b) => a + b, 0),
          outputMean: mean(waveA.tokens.five_axis.output), outputTotal: waveA.tokens.five_axis.output.reduce((a, b) => a + b, 0),
        },
        four_axis: {
          inputMean: mean(waveA.tokens.four_axis.input), inputTotal: waveA.tokens.four_axis.input.reduce((a, b) => a + b, 0),
          outputMean: mean(waveA.tokens.four_axis.output), outputTotal: waveA.tokens.four_axis.output.reduce((a, b) => a + b, 0),
        },
      },
      latencyMs: {
        five_axis: { mean: mean(waveA.latencyMs.five_axis), median: median(waveA.latencyMs.five_axis), max: Math.max(...waveA.latencyMs.five_axis) },
        four_axis: { mean: mean(waveA.latencyMs.four_axis), median: median(waveA.latencyMs.four_axis), max: Math.max(...waveA.latencyMs.four_axis) },
      },
    },
    waveB,
    waveC,
    canonical,
    waveD,
    waveE,
    waveF,
    waveG,
    recoveryPlane: {
      mechanicallyVerified: recoveryTruth.filter((r) => r.mechanicalVerifyOk).length,
      mechanicallyRejected: recoveryTruth.filter((r) => !r.mechanicalVerifyOk).length,
      details: recoveryTruth,
    },
  };
  writeFileSync(`${outdir}/report.json`, JSON.stringify(reportDoc, null, 2));
  console.log(`report -> ${outdir}/report.json`);
  console.log(`calls=${calls.length} ok=${reportDoc.callCountOk} failed=${failedCalls.length} malformed=${malformed.length}`);
  console.log(`waveA mean|delta| per axis: ${JSON.stringify(Object.fromEntries(Object.entries(waveA.perAxis).map(([k, v]) => [k, (v as { meanAbsDelta: number }).meanAbsDelta])))}`);
}
