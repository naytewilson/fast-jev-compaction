import { describe, expect, it } from 'vitest';
import {
  createCalibratedPolicyReceipt,
  verifyCalibratedPolicyReceipt,
} from '../src/lab/calibrated-policy-receipt.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

function input() {
  return {
    traceId: 'trace-1',
    sourceRunId: 'run-1',
    providerProfileDigest: d('1'),
    calibrationIdentity: d('2'),
    calibrationArtifactDigest: d('3'),
    decisionContractDigest: d('4'),
    policyProfileDigest: d('5'),
    rawReplayReceiptDigest: d('6'),
    rawObservationDigest: d('7'),
    calibratedObservationDigest: d('8'),
    thresholds: {
      evidenceSufficientFloor: 0.8,
      keepFull: 0.8,
      retain: 0.5,
    },
    decisions: [{
      candidateId: 'cand-1',
      sourceDigest: d('9'),
      disposition: 'REFERENTIAL' as const,
      reason: 'still_needed_reference' as const,
      mechanicalRecoveryVerified: true,
      recoveryFailureCode: null,
    }],
  };
}

describe('CalibratedPolicyReceipt', () => {
  it('binds calibration, thresholds, observations, recovery, and decision reasons', () => {
    const receipt = createCalibratedPolicyReceipt(input());
    expect(receipt.schema).toBe('anvil.calibrated-policy-receipt.v1');
    expect(receipt.thresholdDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(receipt.decisionSetDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(receipt.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(verifyCalibratedPolicyReceipt(receipt)).toBe(true);
  });

  it('detects observation, threshold, decision, or recovery tampering', () => {
    const receipt = createCalibratedPolicyReceipt(input());
    expect(verifyCalibratedPolicyReceipt({
      ...receipt,
      calibratedObservationDigest: d('a'),
    } as any)).toBe(false);
    expect(verifyCalibratedPolicyReceipt({
      ...receipt,
      thresholds: { ...receipt.thresholds, retain: 0.4 },
    } as any)).toBe(false);
    expect(verifyCalibratedPolicyReceipt({
      ...receipt,
      decisions: [{ ...receipt.decisions[0], reason: 'evictable' }],
    } as any)).toBe(false);
    expect(verifyCalibratedPolicyReceipt({
      ...receipt,
      decisions: [{
        ...receipt.decisions[0],
        mechanicalRecoveryVerified: false,
        recoveryFailureCode: 'missing_object',
      }],
    } as any)).toBe(false);
  });

  it('rejects unknown reasons and inconsistent recovery evidence', () => {
    expect(() => createCalibratedPolicyReceipt({
      ...input(),
      decisions: [{
        ...input().decisions[0],
        reason: 'invented' as any,
      }],
    })).toThrow(/reason/i);

    expect(() => createCalibratedPolicyReceipt({
      ...input(),
      decisions: [{
        ...input().decisions[0],
        mechanicalRecoveryVerified: true,
        recoveryFailureCode: 'missing_object',
      }],
    })).toThrow(/recovery/i);
  });

  it('rejects structural extra fields during verification', () => {
    const receipt = createCalibratedPolicyReceipt(input());
    expect(verifyCalibratedPolicyReceipt({ ...receipt, extra: true } as any)).toBe(false);
  });
});
