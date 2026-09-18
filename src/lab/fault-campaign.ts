import type {
  DegradedScenario,
  DegradedTrialCycle,
} from './degraded-trial.js';

const DEGRADED_SCENARIOS: readonly Exclude<DegradedScenario, 'FULL'>[] = [
  'PARTIAL',
  'HEAD_TAIL',
  'CONTRADICTORY',
  'IRRELEVANT',
  'ABSENT',
  'MODEL_BUMP',
  'QUANTIZATION_SHIFT',
  'NORMALIZER_SHIFT',
  'CALIBRATION_POISON_ATTEMPT',
  'DUPLICATE_RECALIBRATION_STORM',
  'CANARY_REGRESSION',
  'ROLLBACK',
  'STALE_EVIDENCE_VIEW',
  'RECEIPT_ENRICHMENT_PRESSURE',
  'PROVIDER_IDENTITY_DOWNGRADE',
];

function freezeCycle(cycle: DegradedTrialCycle): Readonly<DegradedTrialCycle> {
  return Object.freeze({ ...cycle });
}

export function buildSyntheticFaultCampaign(
  degradedCycles: number,
): readonly Readonly<DegradedTrialCycle>[] {
  if (!Number.isSafeInteger(degradedCycles) || degradedCycles <= 0) {
    throw new TypeError('degradedCycles must be a positive safe integer');
  }

  const cycles: Readonly<DegradedTrialCycle>[] = [
    freezeCycle({
      scenario: 'FULL',
      shouldHavePolicyAuthority: true,
      policyTriggered: true,
      taskCompleted: true,
      fallbackActivated: false,
      detectMs: 0.1,
      routeMs: 0.1,
      firstUsefulResultMs: 1,
      fallbackCompleteMs: null,
      calibrationProbability: 0.95,
      calibrationOutcome: 1,
      syntheticTiming: true,
    }),
  ];

  for (let index = 0; index < degradedCycles; index += 1) {
    const scenario = DEGRADED_SCENARIOS[index % DEGRADED_SCENARIOS.length];
    cycles.push(freezeCycle({
      scenario,
      shouldHavePolicyAuthority: false,
      policyTriggered: false,
      taskCompleted: true,
      fallbackActivated: true,
      detectMs: 0.1 + (index % 7) * 0.01,
      routeMs: 0.2 + (index % 5) * 0.02,
      firstUsefulResultMs: 2 + (index % 11) * 0.1,
      fallbackCompleteMs: 8 + (index % 13) * 0.25,
      calibrationProbability: 0.05 + (index % 5) * 0.01,
      calibrationOutcome: 0,
      syntheticTiming: true,
    }));
  }

  return Object.freeze(cycles);
}
