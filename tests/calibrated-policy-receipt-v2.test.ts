import { describe, expect, it } from 'vitest';
import {
  createCalibratedPolicyReceiptV2,
  verifyCalibratedPolicyReceiptV2,
} from '../src/lab/calibrated-policy-receipt-v2.js';
import { SEMANTIC_OBSERVATION_ABI_DIGEST_V2 } from '../src/lab/semantic-contract-v2.js';
import { deriveSemanticPolicyProfileV2 } from '../src/lab/semantic-policy-profile-v2.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

function input() {
  const thresholds = {
    evidenceSufficientFloor: 0.8,
    retain: 0.5,
    keepFull: 0.8,
    reviewFloor: 0.8,
  };
  const policyProfile = deriveSemanticPolicyProfileV2({
    id: 'jev-v2-shadow-policy',
    version: '2.0.0',
    thresholds,
  });
  return {
    traceId: 'trace-v2',
    sourceRunId: 'run-v2',
    providerProfileDigest: d('1'),
    observationABIDigest: SEMANTIC_OBSERVATION_ABI_DIGEST_V2,
    compiledProgramDigest: d('3'),
    calibrationIdentity: d('4'),
    calibrationArtifactDigest: d('5'),
    decisionContractDigest: d('6'),
    policyProfileId: policyProfile.id,
    policyProfileVersion: policyProfile.version,
    policyProfileDigest: policyProfile.policyProfileDigest,
    policySemanticsDigest: policyProfile.policySemanticsDigest,
    rawReplayReceiptDigest: d('9'),
    rawObservationDigest: d('a'),
    calibratedObservationDigest: d('b'),
    thresholds,
    decisions: [{
      candidate_id: 'cand-v2',
      source_digest: d('c'),
      disposition: 'REFERENTIAL' as const,
      semantic_authority_used: true,
      review_advisory: false,
      reason: 'reversible_reference' as const,
      mechanical_recovery_status: 'VERIFIED' as const,
      recovery_failure_code: null,
      mechanical_recovery_evidence_digest: d('d'),
    }],
  };
}

describe('CalibratedPolicyReceipt V2', () => {
  it('binds V2 ABI, program, calibration, policy semantics, thresholds, and recovery', () => {
    const receipt = createCalibratedPolicyReceiptV2(input());
    expect(receipt.schema).toBe('anvil.calibrated-policy-receipt.v2');
    expect(receipt.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(receipt.thresholdDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(receipt.decisionSetDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(verifyCalibratedPolicyReceiptV2(receipt)).toBe(true);
  });

  it('detects policy, threshold, ABI, observation, and recovery tampering', () => {
    const receipt = createCalibratedPolicyReceiptV2(input());
    for (const tampered of [
      { ...receipt, observationABIDigest: d('e') },
      { ...receipt, policyProfileDigest: d('e') },
      { ...receipt, calibratedObservationDigest: d('e') },
      { ...receipt, thresholds: { ...receipt.thresholds, retain: 0.4 } },
      {
        ...receipt,
        decisions: [{
          ...receipt.decisions[0],
          mechanical_recovery_evidence_digest: d('e'),
        }],
      },
    ]) {
      expect(verifyCalibratedPolicyReceiptV2(tampered as any)).toBe(false);
    }
  });

  it('rejects policy identity that is not derived from the exact thresholds', () => {
    expect(() => createCalibratedPolicyReceiptV2({
      ...input(),
      policyProfileDigest: d('e'),
    })).toThrow(/policy profile digest/i);
  });

  it('rejects inconsistent recovery state', () => {
    expect(() => createCalibratedPolicyReceiptV2({
      ...input(),
      decisions: [{
        ...input().decisions[0],
        mechanical_recovery_status: 'VERIFIED' as const,
        recovery_failure_code: 'missing_object' as const,
      }],
    })).toThrow(/recovery/i);
  });
});
