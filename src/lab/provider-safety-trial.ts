import type { Digest256 } from './identity.js';
import {
  evaluateDegradedTrial,
  type DegradedTrialCycle,
  type DegradedTrialResult,
} from './degraded-trial.js';
import {
  verifyProviderExecutionProfile,
  type ProviderExecutionProfile,
} from './provider-profile.js';
import { sha256Digest } from './recovery.js';

export type SafetyEvidenceAuthority =
  | 'MEASURED_SHADOW'
  | 'NON_AUTHORITATIVE';

export interface ProviderSafetyTrialInput {
  providerProfile: ProviderExecutionProfile;
  calibrationIdentity: Digest256;
  policyProfileDigest: Digest256;
  observationABIDigest: Digest256;
  cycles: readonly DegradedTrialCycle[];
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISSUE_TOKEN = Symbol('ANVIL.ProviderSafetyTrialArtifact.v1');
const ISSUED = new WeakSet<object>();

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) throw new TypeError(`${field} must be canonical sha256`);
}

function freezeResult(result: DegradedTrialResult): Readonly<DegradedTrialResult> {
  return Object.freeze({
    ...result,
    scenarioCounts: Object.freeze({ ...result.scenarioCounts }),
    falseAuthority: Object.freeze({ ...result.falseAuthority }),
    routeLatencyMs: Object.freeze({ ...result.routeLatencyMs }),
    firstUsefulResultMs: Object.freeze({ ...result.firstUsefulResultMs }),
    calibration: result.calibration === null
      ? null
      : Object.freeze({ ...result.calibration }),
  });
}

function cloneCycles(cycles: readonly DegradedTrialCycle[]): readonly Readonly<DegradedTrialCycle>[] {
  return Object.freeze(cycles.map((cycle) => Object.freeze({ ...cycle })));
}

function trialDigest(input: {
  providerProfileDigest: Digest256;
  calibrationIdentity: Digest256;
  policyProfileDigest: Digest256;
  observationABIDigest: Digest256;
  evidenceAuthority: SafetyEvidenceAuthority;
  cyclesDigest: Digest256;
  result: Readonly<DegradedTrialResult>;
}): Digest256 {
  return sha256Digest(JSON.stringify({
    schema: 'anvil.provider-safety-trial.v1',
    ...input,
  }));
}

export class ProviderSafetyTrialArtifact {
  public readonly schema = 'anvil.provider-safety-trial.v1' as const;

  private constructor(
    token: symbol,
    public readonly providerProfileDigest: Digest256,
    public readonly calibrationIdentity: Digest256,
    public readonly policyProfileDigest: Digest256,
    public readonly observationABIDigest: Digest256,
    public readonly evidenceAuthority: SafetyEvidenceAuthority,
    public readonly cycles: readonly Readonly<DegradedTrialCycle>[],
    public readonly cyclesDigest: Digest256,
    public readonly result: Readonly<DegradedTrialResult>,
    public readonly trialDigest: Digest256,
  ) {
    if (token !== ISSUE_TOKEN) throw new Error('safety trial constructor is registry protected');
    ISSUED.add(this);
    Object.freeze(this);
  }

  static issue(token: symbol, fields: {
    providerProfileDigest: Digest256;
    calibrationIdentity: Digest256;
    policyProfileDigest: Digest256;
    observationABIDigest: Digest256;
    evidenceAuthority: SafetyEvidenceAuthority;
    cycles: readonly Readonly<DegradedTrialCycle>[];
    cyclesDigest: Digest256;
    result: Readonly<DegradedTrialResult>;
    trialDigest: Digest256;
  }): ProviderSafetyTrialArtifact {
    if (token !== ISSUE_TOKEN) throw new Error('safety trial issuer mismatch');
    return new ProviderSafetyTrialArtifact(
      token,
      fields.providerProfileDigest,
      fields.calibrationIdentity,
      fields.policyProfileDigest,
      fields.observationABIDigest,
      fields.evidenceAuthority,
      fields.cycles,
      fields.cyclesDigest,
      fields.result,
      fields.trialDigest,
    );
  }
}

export class ProviderSafetyTrialRegistry {
  register(input: ProviderSafetyTrialInput): Readonly<ProviderSafetyTrialArtifact> {
    if (!verifyProviderExecutionProfile(input.providerProfile)) {
      throw new TypeError('provider profile is not internally verifiable');
    }
    requireDigest(input.calibrationIdentity, 'calibrationIdentity');
    requireDigest(input.policyProfileDigest, 'policyProfileDigest');
    requireDigest(input.observationABIDigest, 'observationABIDigest');
    if (input.providerProfile.observationABIDigest !== input.observationABIDigest) {
      throw new Error('provider safety trial Observation ABI mismatch');
    }

    const cycles = cloneCycles(input.cycles);
    const result = freezeResult(evaluateDegradedTrial(cycles));
    const evidenceAuthority: SafetyEvidenceAuthority =
      result.timingEvidence === 'measured' &&
      result.falseAuthority.opportunities > 0
        ? 'MEASURED_SHADOW'
        : 'NON_AUTHORITATIVE';
    const cyclesDigest = sha256Digest(JSON.stringify({
      schema: 'anvil.provider-safety-cycles.v1',
      cycles,
    }));
    const digest = trialDigest({
      providerProfileDigest: input.providerProfile.providerProfileDigest,
      calibrationIdentity: input.calibrationIdentity,
      policyProfileDigest: input.policyProfileDigest,
      observationABIDigest: input.observationABIDigest,
      evidenceAuthority,
      cyclesDigest,
      result,
    });

    return ProviderSafetyTrialArtifact.issue(ISSUE_TOKEN, {
      providerProfileDigest: input.providerProfile.providerProfileDigest,
      calibrationIdentity: input.calibrationIdentity,
      policyProfileDigest: input.policyProfileDigest,
      observationABIDigest: input.observationABIDigest,
      evidenceAuthority,
      cycles,
      cyclesDigest,
      result,
      trialDigest: digest,
    });
  }
}

export function verifyProviderSafetyTrialArtifact(
  value: unknown,
): value is ProviderSafetyTrialArtifact {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      !(value instanceof ProviderSafetyTrialArtifact) ||
      !ISSUED.has(value)
    ) return false;
    const trial = value as ProviderSafetyTrialArtifact;
    if (trial.schema !== 'anvil.provider-safety-trial.v1') return false;
    requireDigest(trial.providerProfileDigest, 'providerProfileDigest');
    requireDigest(trial.calibrationIdentity, 'calibrationIdentity');
    requireDigest(trial.policyProfileDigest, 'policyProfileDigest');
    requireDigest(trial.observationABIDigest, 'observationABIDigest');
    requireDigest(trial.cyclesDigest, 'cyclesDigest');
    requireDigest(trial.trialDigest, 'trialDigest');

    const expectedCycles = sha256Digest(JSON.stringify({
      schema: 'anvil.provider-safety-cycles.v1',
      cycles: trial.cycles,
    }));
    if (expectedCycles !== trial.cyclesDigest) return false;

    const recomputed = freezeResult(evaluateDegradedTrial(trial.cycles));
    if (JSON.stringify(recomputed) !== JSON.stringify(trial.result)) return false;
    const expectedAuthority: SafetyEvidenceAuthority =
      recomputed.timingEvidence === 'measured' &&
      recomputed.falseAuthority.opportunities > 0
        ? 'MEASURED_SHADOW'
        : 'NON_AUTHORITATIVE';
    if (trial.evidenceAuthority !== expectedAuthority) return false;

    return trialDigest({
      providerProfileDigest: trial.providerProfileDigest,
      calibrationIdentity: trial.calibrationIdentity,
      policyProfileDigest: trial.policyProfileDigest,
      observationABIDigest: trial.observationABIDigest,
      evidenceAuthority: trial.evidenceAuthority,
      cyclesDigest: trial.cyclesDigest,
      result: trial.result,
    }) === trial.trialDigest;
  } catch {
    return false;
  }
}
