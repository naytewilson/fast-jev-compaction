import { describe, expect, it } from 'vitest';
import {
  CalibrationEvidenceCompiler,
  InMemoryCAS,
  createToolRecoveryManifest,
  encodeToolEvidence,
  deriveProviderExecutionProfile,
  runCalibratedObservationReplay,
  runObservationOnlyArm,
  verifyCalibratedPolicyReceipt,
} from '../src/lab/index.js';
import type { SemanticCalibrationLabel } from '../src/lab/semantic-label.js';
import type { SemanticReplayPrediction } from '../src/lab/calibration-replay.js';
import { MAPPED_OBSERVATION_AXES } from '../src/lab/types.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

function providerProfile() {
  return deriveProviderExecutionProfile({
    providerId: 'typesafe-system-one/jev-1.13.0',
    providerKind: 'jev-system-one',
    modelIdentityDigest: d('1'),
    modelAssurance: 'opaqueVersioned',
    executionSemanticsDigest: d('2'),
    normalizerDigest: d('3'),
    observationABIDigest: d('4'),
  });
}

function calibrationBuild(profile: ReturnType<typeof providerProfile>) {
  const trainingLabels: SemanticCalibrationLabel[] = [];
  const trainingPredictions: SemanticReplayPrediction[] = [];
  const holdoutLabels: SemanticCalibrationLabel[] = [];
  const holdoutPredictions: SemanticReplayPrediction[] = [];

  const ranges: Record<(typeof MAPPED_OBSERVATION_AXES)[number], [number, number]> = {
    evidence_sufficient: [0.05, 0.25],
    still_needed: [0.10, 0.90],
    full_content_needed: [0.10, 0.90],
    unresolved_evidence: [0.10, 0.90],
  };

  for (const [axisIndex, predicateId] of MAPPED_OBSERVATION_AXES.entries()) {
    const [low, high] = ranges[predicateId];
    for (const split of ['train', 'holdout'] as const) {
      for (const [target, probability] of [[0, low], [1, high]] as const) {
        const labelId = `${split}:${predicateId}:${target}`;
        const label: SemanticCalibrationLabel = {
          labelId,
          authority: 'STRONG',
          decisionContractDigest: d('a'),
          predicateId,
          labelBindingDigest: d('b'),
          sourceDigest: target === 0
            ? d(['5', '6', '7', '8'][axisIndex])
            : d(['9', 'a', 'b', 'c'][axisIndex]),
          outcomeDigest: target === 0 ? d('c') : d('d'),
          target,
          verifierIdentity: 'deterministic:calibrated-policy-test',
        };
        const prediction: SemanticReplayPrediction = {
          labelId,
          predicateId,
          sourceDigest: label.sourceDigest,
          executionProfileDigest: profile.providerProfileDigest,
          observationDigest: target === 0 ? d('e') : d('f'),
          probability,
        };
        if (split === 'train') {
          trainingLabels.push(label);
          trainingPredictions.push(prediction);
        } else {
          holdoutLabels.push(label);
          holdoutPredictions.push(prediction);
        }
      }
    }
  }

  return new CalibrationEvidenceCompiler().compile({
    providerProfile: profile,
    decisionContractDigest: d('a'),
    compiledProgramDigest: d('9'),
    samplingPolicyDigest: d('8'),
    labelAuthorityPolicyDigest: d('7'),
    labelBindingDigest: d('b'),
    trainingLabels,
    trainingPredictions,
    holdoutLabels,
    holdoutPredictions,
    confidenceFloor: 0.8,
    eceBins: 4,
  });
}

function trace() {
  const stdout = 'head\ncritical-middle\ntail';
  return {
    trace_id: 'calibrated-policy',
    source_run_id: 'run-calibrated-policy',
    shared_state: 'preserve evidence',
    candidates: [{
      candidate_id: 'cand-0001',
      stdout,
      stderr: '',
      exit_status: 0,
      head_lines: 1,
      tail_lines: 1,
      presentation_budget_bytes: 1000,
      recovery: createToolRecoveryManifest(stdout, '', 0, 'calibrated-policy-1'),
      critical_evidence: ['critical-middle'],
    }],
  };
}

function provider() {
  return async (request: any) => ({
    schema: 'anvil.mapped-decision-response.v1',
    request_id: request.request_id,
    observations: request.candidate_views.map((candidate: any) => ({
      candidate_id: candidate.candidate_id,
      evidence_sufficient: { noul: 0.25 },
      still_needed: { noul: 0.90 },
      full_content_needed: { noul: 0.10 },
      unresolved_evidence: { noul: 0.10 },
    })),
  });
}

const thresholds = {
  evidenceSufficientFloor: 0.8,
  keepFull: 0.8,
  retain: 0.5,
};

describe('calibrated observation policy replay', () => {
  it('uses calibrated probability rather than lowering the raw evidence threshold', async () => {
    const profile = providerProfile();
    const build = calibrationBuild(profile);
    const t = trace();
    const cas = new InMemoryCAS();
    cas.put(
      'calibrated-policy-1',
      encodeToolEvidence(t.candidates[0].stdout, '', 0),
    );
    const profiles = {
      decision_contract: { id: 'anvil.context-retention.v2', version: '2.0.0', digest: d('a') },
      execution_profile: { id: profile.providerId, version: '1.0.0', digest: profile.providerProfileDigest },
      calibration_profile: { id: 'jev-calibrated', version: '1.0.0', digest: build.calibrationArtifact.calibrationIdentity },
      policy_profile: { id: 'shadow-policy', version: '1.0.0', digest: d('6') },
    };

    const raw = await runObservationOnlyArm(
      t,
      cas,
      profiles,
      thresholds,
      provider(),
    );
    expect(raw.presentations[0].disposition).toBe('ABSTAIN');

    const calibrated = await runCalibratedObservationReplay({
      trace: t,
      cas,
      profiles,
      thresholds,
      providerProfile: profile,
      calibrationArtifact: build.calibrationArtifact,
      provider: provider(),
    });

    expect(calibrated.rawObservations[0].evidence_sufficient.noul).toBe(0.25);
    expect(calibrated.calibratedObservations[0].evidence_sufficient.noul).toBe(1);
    expect(calibrated.presentations[0].disposition).toBe('REFERENTIAL');
    expect(calibrated.calibrationIdentity).toBe(build.calibrationArtifact.calibrationIdentity);
  });

  it('keeps mechanical recovery authoritative after calibration', async () => {
    const profile = providerProfile();
    const build = calibrationBuild(profile);
    const t = trace();
    const profiles = {
      decision_contract: { id: 'anvil.context-retention.v2', version: '2.0.0', digest: d('a') },
      execution_profile: { id: profile.providerId, version: '1.0.0', digest: profile.providerProfileDigest },
      calibration_profile: { id: 'jev-calibrated', version: '1.0.0', digest: build.calibrationArtifact.calibrationIdentity },
      policy_profile: { id: 'shadow-policy', version: '1.0.0', digest: d('6') },
    };

    const calibrated = await runCalibratedObservationReplay({
      trace: t,
      cas: new InMemoryCAS(),
      profiles,
      thresholds,
      providerProfile: profile,
      calibrationArtifact: build.calibrationArtifact,
      provider: provider(),
    });

    expect(calibrated.calibratedObservations[0].evidence_sufficient.noul).toBe(1);
    expect(calibrated.presentations[0].disposition).toBe('FULL');
  });

  it('fails closed on provider/calibration namespace mismatch', async () => {
    const profile = providerProfile();
    const other = deriveProviderExecutionProfile({
      providerId: 'neo/qwen-ane',
      providerKind: 'qwen-ane',
      modelIdentityDigest: d('2'),
      modelAssurance: 'contentVerified',
      executionSemanticsDigest: d('3'),
      normalizerDigest: d('3'),
      observationABIDigest: d('4'),
    });
    const build = calibrationBuild(profile);
    const t = trace();
    const profiles = {
      decision_contract: { id: 'anvil.context-retention.v2', version: '2.0.0', digest: d('a') },
      execution_profile: { id: other.providerId, version: '1.0.0', digest: other.providerProfileDigest },
      calibration_profile: { id: 'wrong', version: '1.0.0', digest: build.calibrationArtifact.calibrationIdentity },
      policy_profile: { id: 'shadow-policy', version: '1.0.0', digest: d('6') },
    };

    await expect(runCalibratedObservationReplay({
      trace: t,
      cas: new InMemoryCAS(),
      profiles,
      thresholds,
      providerProfile: other,
      calibrationArtifact: build.calibrationArtifact,
      provider: provider(),
    })).rejects.toThrow(/provider profile|calibration/i);
  });
  it('emits typed policy decisions and a source-bound calibrated policy receipt', async () => {
    const profile = providerProfile();
    const build = calibrationBuild(profile);
    const t = trace();
    const cas = new InMemoryCAS();
    cas.put(
      'calibrated-policy-1',
      encodeToolEvidence(t.candidates[0].stdout, '', 0),
    );
    const profiles = {
      decision_contract: { id: 'anvil.context-retention.v2', version: '2.0.0', digest: d('a') },
      execution_profile: { id: profile.providerId, version: '1.0.0', digest: profile.providerProfileDigest },
      calibration_profile: { id: 'jev-calibrated', version: '1.0.0', digest: build.calibrationArtifact.calibrationIdentity },
      policy_profile: { id: 'shadow-policy', version: '1.0.0', digest: d('6') },
    };

    const calibrated = await runCalibratedObservationReplay({
      trace: t,
      cas,
      profiles,
      thresholds,
      providerProfile: profile,
      calibrationArtifact: build.calibrationArtifact,
      provider: provider(),
    });

    expect(calibrated.policyDecisions).toEqual([
      expect.objectContaining({
        candidateId: 'cand-0001',
        disposition: 'REFERENTIAL',
        reason: 'still_needed_reference',
        mechanicalRecoveryVerified: true,
      }),
    ]);
    expect(calibrated.receipt.rawReplayReceiptDigest)
      .toBe(calibrated.rawReplayReceipt.receipt_digest);
    expect(calibrated.receipt.calibrationArtifactDigest)
      .toBe(build.calibrationArtifact.artifactDigest);
    expect(calibrated.receipt.decisions[0].reason).toBe('still_needed_reference');
    expect(verifyCalibratedPolicyReceipt(calibrated.receipt)).toBe(true);
  });

});
