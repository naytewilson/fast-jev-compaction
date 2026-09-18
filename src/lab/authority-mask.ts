export interface SemanticAuthorityMask {
  source: boolean;
  evidence: boolean;
  calibration: boolean;
  authority: boolean;
  recovery: boolean;
}

export interface SemanticCapabilities {
  mayObserve: boolean;
  mayScoreSemantics: boolean;
  mayDrivePolicy: boolean;
  mayPresentReferentially: boolean;
}

const FIELDS = [
  'source',
  'evidence',
  'calibration',
  'authority',
  'recovery',
] as const;

export function deriveSemanticCapabilities(mask: SemanticAuthorityMask): SemanticCapabilities {
  const mayObserve = mask.source;
  const mayScoreSemantics = mask.source && mask.evidence;
  const mayDrivePolicy =
    mask.source && mask.evidence && mask.calibration && mask.authority;

  return {
    mayObserve,
    mayScoreSemantics,
    mayDrivePolicy,
    mayPresentReferentially: mayDrivePolicy && mask.recovery,
  };
}

export function isAuthorityPreservingAcceleration(
  before: SemanticAuthorityMask,
  after: SemanticAuthorityMask,
): boolean {
  return FIELDS.every((field) => !after[field] || before[field]);
}

export function assertAuthorityPreservingAcceleration(
  before: SemanticAuthorityMask,
  after: SemanticAuthorityMask,
): void {
  if (!isAuthorityPreservingAcceleration(before, after)) {
    throw new Error('acceleration layer attempted to widen authority');
  }
}
