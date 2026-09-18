import { describe, expect, it } from 'vitest';
import {
  CalibrationEvidenceCompilerV2,
  InMemoryCAS,
  compileContextRetentionProgramV2,
  createToolRecoveryManifest,
  deriveSemanticPolicyProfileV2,
  encodeToolEvidence,
  runCalibratedObservationReplayV2,
  runObservationOnlyArmV2,
  verifyCalibratedPolicyReceiptV2,
} from '../src/lab/index.js';
import {
  makeCalibrationCorpusV2,
  makeProviderProfileV2,
  d2,
} from './v2-calibration-fixtures.js';

const thresholds = {
  evidenceSufficientFloor: 0.8,
  retain: 0.5,
  keepFull: 0.8,
  reviewFloor: 0.8,
};

function trace() {
  const stdout = 'head\ncritical-middle\ntail';
  return {
    trace_id: 'calibrated-policy-v2',
    source_run_id: 'run-calibrated-policy-v2',
    shared_state: 'preserve source-bound evidence',
    candidates: [{
      candidate_id: 'cand-v2',
      stdout,
      stderr: '',
      exit_status: 0,
      head_lines: 1,
      tail_lines: 1,
      presentation_budget_bytes: 1000,
      recovery: createToolRecoveryManifest(stdout, '', 0, 'calibrated-policy-v2-object'),
      critical_evidence: ['critical-middle'],
    }],
  };
}

function buildCalibration() {
  const providerProfile = makeProviderProfileV2();
  const corpus = makeCalibrationCorpusV2(providerProfile.providerProfileDigest);
  corpus.trainingPredictions = corpus.trainingPredictions.map((prediction) =>
    prediction.labelId === 'train-evidence_sufficient-1'
      ? { ...prediction, probability: 0.25 }
      : prediction);
  const decisionContract = {
    id: 'anvil.context-retention.v2',
    version: '2.0.0',
    digest: d2('a'),
  };
  const program = compileContextRetentionProgramV2(decisionContract);
  const build = new CalibrationEvidenceCompilerV2().compile({
    providerProfile,
    decisionContractDigest: decisionContract.digest,
    compiledProgramDigest: program.programDigest,
    samplingPolicyDigest: d2('c'),
    labelAuthorityPolicyDigest: d2('d'),
    labelBindingDigest: d2('e'),
    trainingLabels: corpus.trainingLabels,
    trainingPredictions: corpus.trainingPredictions,
    holdoutLabels: corpus.holdoutLabels,
    holdoutPredictions: corpus.holdoutPredictions,
    confidenceFloor: 0.8,
    eceBins: 5,
  });
  return { providerProfile, decisionContract, program, build };
}

function provider() {
  return async (request: any) => ({
    schema: 'anvil.semantic-decision-response.v2',
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

describe('calibrated semantic policy replay V2', () => {
  it('calibrates the sensor without lowering the policy threshold', async () => {
    const { providerProfile, decisionContract, build } = buildCalibration();
    const policyProfile = deriveSemanticPolicyProfileV2({
      id: 'jev-v2-shadow-policy',
      version: '2.0.0',
      thresholds,
    });
    const profiles = {
      decision_contract: decisionContract,
      execution_profile: {
        id: providerProfile.providerId,
        version: '2.0.0',
        digest: providerProfile.providerProfileDigest,
      },
      calibration_profile: {
        id: 'jev-v2-calibration',
        version: '2.0.0',
        digest: build.calibrationArtifact.calibrationIdentity,
      },
      policy_profile: {
        id: policyProfile.id,
        version: policyProfile.version,
        digest: policyProfile.policyProfileDigest,
      },
    };
    const t = trace();
    const cas = new InMemoryCAS();
    cas.put(
      'calibrated-policy-v2-object',
      encodeToolEvidence(t.candidates[0].stdout, '', 0),
    );

    const raw = await runObservationOnlyArmV2(
      t,
      cas,
      profiles,
      thresholds,
      provider(),
    );
    expect(raw.presentations[0].disposition).toBe('ABSTAIN');

    const calibrated = await runCalibratedObservationReplayV2({
      trace: t,
      cas,
      profiles,
      policyProfile,
      providerProfile,
      calibrationArtifact: build.calibrationArtifact,
      provider: provider(),
    });

    expect(calibrated.rawObservations[0].evidence_sufficient.noul).toBe(0.25);
    expect(calibrated.calibratedObservations[0].evidence_sufficient.noul).toBe(1);
    expect(calibrated.presentations[0].disposition).toBe('REFERENTIAL');
    expect(calibrated.policyDecisions[0].reason).toBe('reversible_reference');
    expect(calibrated.receipt?.policyProfileDigest)
      .toBe(policyProfile.policyProfileDigest);
    expect(calibrated.receipt &&
      verifyCalibratedPolicyReceiptV2(calibrated.receipt)).toBe(true);
  });

  it('keeps mechanical recovery authoritative after favorable calibration', async () => {
    const { providerProfile, decisionContract, build } = buildCalibration();
    const policyProfile = deriveSemanticPolicyProfileV2({
      id: 'jev-v2-shadow-policy',
      version: '2.0.0',
      thresholds,
    });
    const profiles = {
      decision_contract: decisionContract,
      execution_profile: {
        id: providerProfile.providerId,
        version: '2.0.0',
        digest: providerProfile.providerProfileDigest,
      },
      calibration_profile: {
        id: 'jev-v2-calibration',
        version: '2.0.0',
        digest: build.calibrationArtifact.calibrationIdentity,
      },
      policy_profile: {
        id: policyProfile.id,
        version: policyProfile.version,
        digest: policyProfile.policyProfileDigest,
      },
    };

    const calibrated = await runCalibratedObservationReplayV2({
      trace: trace(),
      cas: new InMemoryCAS(),
      profiles,
      policyProfile,
      providerProfile,
      calibrationArtifact: build.calibrationArtifact,
      provider: provider(),
    });

    expect(calibrated.calibratedObservations[0].evidence_sufficient.noul).toBe(1);
    expect(calibrated.presentations[0].disposition).toBe('FULL');
    expect(calibrated.policyDecisions[0].reason)
      .toBe('mechanical_recovery_unavailable');
  });

  it('fails closed when policy identity or provider/calibration identity drifts', async () => {
    const { providerProfile, decisionContract, build } = buildCalibration();
    const policyProfile = deriveSemanticPolicyProfileV2({
      id: 'jev-v2-shadow-policy',
      version: '2.0.0',
      thresholds,
    });
    const profiles = {
      decision_contract: decisionContract,
      execution_profile: {
        id: providerProfile.providerId,
        version: '2.0.0',
        digest: providerProfile.providerProfileDigest,
      },
      calibration_profile: {
        id: 'jev-v2-calibration',
        version: '2.0.0',
        digest: build.calibrationArtifact.calibrationIdentity,
      },
      policy_profile: {
        id: policyProfile.id,
        version: policyProfile.version,
        digest: d2('0'),
      },
    };

    await expect(runCalibratedObservationReplayV2({
      trace: trace(),
      cas: new InMemoryCAS(),
      profiles,
      policyProfile,
      providerProfile,
      calibrationArtifact: build.calibrationArtifact,
      provider: provider(),
    })).rejects.toThrow(/policy profile/i);
  });
});
