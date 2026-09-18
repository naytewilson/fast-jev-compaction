import { describe, expect, it } from 'vitest';
import {
  CalibrationGenerationRegistry,
  RecalibrationCoordinator,
  transitionCalibrationGeneration,
  type CalibrationGeneration,
} from '../src/lab/recalibration.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

function active(generation = 4): CalibrationGeneration {
  return {
    generation,
    state: 'ACTIVE',
    calibrationIdentity: d('1'),
    authorityIdentity: d('2'),
  };
}

describe('self-healing calibration generations', () => {
  it('rejects illegal state transitions', () => {
    expect(() => transitionCalibrationGeneration(active(), 'CANARY'))
      .toThrow(/illegal recalibration transition/i);
  });

  it('supports the full compatible-drift recovery chain', () => {
    let current = active();
    for (const state of [
      'DEGRADED_SAFE',
      'REPLAYING',
      'FITTING',
      'SHADOW_VALIDATING',
      'CANARY',
      'PROMOTING',
      'ACTIVE_NEW_GENERATION',
    ] as const) {
      current = transitionCalibrationGeneration(current, state);
    }

    expect(current.generation).toBe(5);
    expect(current.state).toBe('ACTIVE_NEW_GENERATION');
  });

  it('atomically promotes a complete immutable generation and preserves the old snapshot', () => {
    const initial = active();
    const registry = new CalibrationGenerationRegistry(initial);
    const before = registry.snapshot();

    let candidate = transitionCalibrationGeneration(initial, 'DEGRADED_SAFE');
    candidate = { ...candidate, calibrationIdentity: d('3'), authorityIdentity: d('4') };
    for (const state of [
      'REPLAYING',
      'FITTING',
      'SHADOW_VALIDATING',
      'CANARY',
      'PROMOTING',
      'ACTIVE_NEW_GENERATION',
    ] as const) {
      candidate = transitionCalibrationGeneration(candidate, state);
    }

    const promoted = registry.promote(candidate);
    expect(promoted.generation).toBe(5);
    expect(promoted.state).toBe('ACTIVE');
    expect(promoted.calibrationIdentity).toBe(d('3'));
    expect(before).toEqual(initial);
    expect(registry.snapshot()).not.toBe(before);
  });
});

describe('recalibration single-flight', () => {
  it('runs one worker for concurrent requests targeting the same identity', async () => {
    const coordinator = new RecalibrationCoordinator();
    let calls = 0;
    const work = async () => {
      calls += 1;
      await Promise.resolve();
      return 'ready';
    };

    const results = await Promise.all(
      Array.from({ length: 25 }, () => coordinator.runSingleFlight(d('a'), work)),
    );

    expect(calls).toBe(1);
    expect(results.every((value) => value === 'ready')).toBe(true);
  });

  it('allows distinct target identities to run independently', async () => {
    const coordinator = new RecalibrationCoordinator();
    let calls = 0;
    const work = async () => {
      calls += 1;
      return calls;
    };

    await Promise.all([
      coordinator.runSingleFlight(d('a'), work),
      coordinator.runSingleFlight(d('b'), work),
    ]);
    expect(calls).toBe(2);
  });

  it('clears a rejected flight so a later retry can execute', async () => {
    const coordinator = new RecalibrationCoordinator();
    let calls = 0;

    await expect(coordinator.runSingleFlight(d('a'), async () => {
      calls += 1;
      throw new Error('fit failed');
    })).rejects.toThrow(/fit failed/);

    await expect(coordinator.runSingleFlight(d('a'), async () => {
      calls += 1;
      return 'recovered';
    })).resolves.toBe('recovered');

    expect(calls).toBe(2);
  });
});
