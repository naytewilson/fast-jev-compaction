import type { CalibrationEvidenceLabel } from './calibration-data.js';
import { sha256Digest } from './recovery.js';

export type RegretDisposition =
  | 'KEEP_FULL'
  | 'KEEP_HEAD_TAIL'
  | 'KEEP_REFERENCE'
  | 'EVICT_FROM_PRESENTATION'
  | 'ABSTAIN';

export interface RegretDecisionRecord {
  decisionId: string;
  requestId: string;
  sourceDigest: string;
  observationDigest: string;
  calibrationIdentity: string;
  authorityIdentity: string;
  disposition: RegretDisposition;
}

export interface RegretOutcomeRecord {
  decisionId: string;
  outcomeDigest: string;
  verified: boolean;
  verifierIdentity?: string;
  taskSucceeded: boolean;
  unnecessaryReread: boolean;
  exactRehydrationRequired: boolean;
}

export type RegretClassification =
  | 'SAFE_EVICTION'
  | 'FALSE_EVICTION'
  | 'SAFE_RETENTION'
  | 'UNRESOLVED';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const REDUCED = new Set<RegretDisposition>([
  'KEEP_HEAD_TAIL',
  'KEEP_REFERENCE',
  'EVICT_FROM_PRESENTATION',
]);

function validateDigest(value: string, name: string): void {
  if (!DIGEST.test(value)) throw new TypeError(`${name} must be canonical sha256`);
}

function freezeDecision(value: RegretDecisionRecord): Readonly<RegretDecisionRecord> {
  if (value.decisionId.length === 0 || value.requestId.length === 0) {
    throw new TypeError('decision/request ids must be non-empty');
  }
  validateDigest(value.sourceDigest, 'sourceDigest');
  validateDigest(value.observationDigest, 'observationDigest');
  validateDigest(value.calibrationIdentity, 'calibrationIdentity');
  validateDigest(value.authorityIdentity, 'authorityIdentity');
  return Object.freeze({ ...value });
}

function freezeOutcome(value: RegretOutcomeRecord): Readonly<RegretOutcomeRecord> {
  validateDigest(value.outcomeDigest, 'outcomeDigest');
  if (value.verified && (value.verifierIdentity === undefined || value.verifierIdentity.length === 0)) {
    throw new Error('verified outcome requires verifier identity');
  }
  return Object.freeze({ ...value });
}

export class CounterfactualRegretLedger {
  private readonly decisions = new Map<string, Readonly<RegretDecisionRecord>>();
  private readonly outcomes = new Map<string, Readonly<RegretOutcomeRecord>>();

  recordDecision(decision: RegretDecisionRecord): void {
    if (this.decisions.has(decision.decisionId)) {
      throw new Error(`duplicate decision ${decision.decisionId}`);
    }
    this.decisions.set(decision.decisionId, freezeDecision(decision));
  }

  recordOutcome(outcome: RegretOutcomeRecord): void {
    if (!this.decisions.has(outcome.decisionId)) {
      throw new Error(`unknown decision ${outcome.decisionId}`);
    }
    if (this.outcomes.has(outcome.decisionId)) {
      throw new Error(`duplicate outcome ${outcome.decisionId}`);
    }
    this.outcomes.set(outcome.decisionId, freezeOutcome(outcome));
  }

  classify(decisionId: string): RegretClassification {
    const decision = this.decisions.get(decisionId);
    if (decision === undefined) throw new Error(`unknown decision ${decisionId}`);
    const outcome = this.outcomes.get(decisionId);
    if (outcome === undefined || !outcome.verified) return 'UNRESOLVED';

    if (REDUCED.has(decision.disposition)) {
      if (
        !outcome.taskSucceeded ||
        outcome.unnecessaryReread ||
        outcome.exactRehydrationRequired
      ) {
        return 'FALSE_EVICTION';
      }
      return 'SAFE_EVICTION';
    }

    return outcome.taskSucceeded ? 'SAFE_RETENTION' : 'UNRESOLVED';
  }

  materializeCalibrationLabels(): readonly Readonly<CalibrationEvidenceLabel>[] {
    const labels: CalibrationEvidenceLabel[] = [];
    const ids = [...this.decisions.keys()].sort((a, b) => a.localeCompare(b));

    for (const decisionId of ids) {
      const decision = this.decisions.get(decisionId)!;
      const outcome = this.outcomes.get(decisionId);
      if (outcome === undefined) continue;

      const classification = this.classify(decisionId);
      const boundOutcomeDigest = sha256Digest(JSON.stringify({
        decision,
        outcome,
        classification,
      }));

      const strong = outcome.verified && outcome.verifierIdentity !== undefined;
      labels.push(Object.freeze({
        id: `regret:${decisionId}`,
        authority: strong ? 'STRONG' : 'WEAK',
        sourceDigest: decision.sourceDigest,
        outcomeDigest: boundOutcomeDigest,
        ...(strong ? { verifierIdentity: outcome.verifierIdentity } : {}),
      }));
    }

    return Object.freeze(labels);
  }
}
