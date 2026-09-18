export type RecalibrationState =
  | 'ACTIVE'
  | 'DEGRADED_SAFE'
  | 'REPLAYING'
  | 'FITTING'
  | 'SHADOW_VALIDATING'
  | 'CANARY'
  | 'PROMOTING'
  | 'ACTIVE_NEW_GENERATION'
  | 'ROLLBACK';

export interface CalibrationGeneration {
  generation: number;
  state: RecalibrationState;
  calibrationIdentity: string;
  authorityIdentity: string;
}

const ALLOWED: Readonly<Record<RecalibrationState, readonly RecalibrationState[]>> = {
  ACTIVE: ['DEGRADED_SAFE'],
  DEGRADED_SAFE: ['REPLAYING'],
  REPLAYING: ['FITTING'],
  FITTING: ['SHADOW_VALIDATING'],
  SHADOW_VALIDATING: ['CANARY', 'ROLLBACK'],
  CANARY: ['PROMOTING', 'ROLLBACK'],
  PROMOTING: ['ACTIVE_NEW_GENERATION', 'ROLLBACK'],
  ACTIVE_NEW_GENERATION: ['ACTIVE'],
  ROLLBACK: ['ACTIVE'],
};

function validateGeneration(generation: CalibrationGeneration): void {
  if (!Number.isSafeInteger(generation.generation) || generation.generation < 0) {
    throw new TypeError('calibration generation must be a non-negative safe integer');
  }
  if (generation.calibrationIdentity.length === 0 || generation.authorityIdentity.length === 0) {
    throw new TypeError('calibration/authority identities must be non-empty');
  }
}

function freezeGeneration(generation: CalibrationGeneration): Readonly<CalibrationGeneration> {
  validateGeneration(generation);
  return Object.freeze({ ...generation });
}

export function transitionCalibrationGeneration(
  current: CalibrationGeneration,
  nextState: RecalibrationState,
): Readonly<CalibrationGeneration> {
  validateGeneration(current);
  if (!ALLOWED[current.state].includes(nextState)) {
    throw new Error(`illegal recalibration transition ${current.state} -> ${nextState}`);
  }

  const generation =
    current.state === 'ACTIVE' && nextState === 'DEGRADED_SAFE'
      ? current.generation + 1
      : current.generation;

  if (!Number.isSafeInteger(generation)) {
    throw new RangeError('calibration generation exhausted');
  }

  return freezeGeneration({
    ...current,
    generation,
    state: nextState,
  });
}

export class CalibrationGenerationRegistry {
  private active: Readonly<CalibrationGeneration>;
  private readonly knownPrevious = new Map<number, Readonly<CalibrationGeneration>>();

  constructor(initial: CalibrationGeneration) {
    if (initial.state !== 'ACTIVE') {
      throw new TypeError('initial calibration generation must be ACTIVE');
    }
    this.active = freezeGeneration(initial);
  }

  snapshot(): Readonly<CalibrationGeneration> {
    return this.active;
  }

  promote(candidate: CalibrationGeneration): Readonly<CalibrationGeneration> {
    validateGeneration(candidate);
    if (candidate.state !== 'ACTIVE_NEW_GENERATION') {
      throw new Error('promotion requires ACTIVE_NEW_GENERATION candidate');
    }
    if (candidate.generation !== this.active.generation + 1) {
      throw new Error('promotion generation must be exactly active + 1');
    }

    this.knownPrevious.set(this.active.generation, this.active);
    const promoted = freezeGeneration({ ...candidate, state: 'ACTIVE' });
    this.active = promoted;
    return promoted;
  }

  rollback(previous: CalibrationGeneration): Readonly<CalibrationGeneration> {
    const known = this.knownPrevious.get(previous.generation);
    if (known === undefined) throw new Error('rollback target is not a known previous generation');
    if (
      known.calibrationIdentity !== previous.calibrationIdentity ||
      known.authorityIdentity !== previous.authorityIdentity
    ) {
      throw new Error('rollback target identity mismatch');
    }
    this.active = known;
    return this.active;
  }
}

export class RecalibrationCoordinator {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  runSingleFlight<T>(targetIdentity: string, work: () => Promise<T>): Promise<T> {
    if (targetIdentity.length === 0) throw new TypeError('target identity must be non-empty');
    const existing = this.inFlight.get(targetIdentity) as Promise<T> | undefined;
    if (existing !== undefined) return existing;

    let promise: Promise<T>;
    promise = Promise.resolve()
      .then(work)
      .finally(() => {
        if (this.inFlight.get(targetIdentity) === promise) {
          this.inFlight.delete(targetIdentity);
        }
      });

    this.inFlight.set(targetIdentity, promise);
    return promise;
  }

  inFlightCount(): number {
    return this.inFlight.size;
  }
}
