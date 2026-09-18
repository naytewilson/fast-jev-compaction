import { validateMappedDecisionRequest } from './mapped-contract.js';
import {
  SEMANTIC_SENSOR_ABI_V2_SCHEMA,
  SEMANTIC_SENSOR_AXES_V2,
  type SemanticSensorAxisV2,
  type SemanticSensorObservationV2,
} from './observation-abi-v2.js';
import { sha256Digest } from './recovery.js';
import type { MappedDecisionRequest } from './types.js';

export const SYSTEM_ONE_SENSOR_V2_ENDPOINT =
  'https://api.typesafe.ai/v1/systemone';
export const SYSTEM_ONE_SENSOR_V2_STATE_SCHEMA =
  'anvil.system-one-sensor-state.v2';

const PINNED_JEV_MODEL = /^jev-\d+\.\d+\.\d+$/;

const AXIS_INSTRUCTIONS: Record<SemanticSensorAxisV2, string> = {
  evidence_sufficient:
    'Estimate whether the bounded candidate view and shared state are sufficient to judge retention for this candidate. Missing, stale, truncated, task-mismatched, or otherwise inadequate evidence should reduce this score.',
  still_needed:
    'Estimate whether this candidate carries information likely needed for the ongoing mission.',
  full_content_needed:
    'Estimate whether replacing omitted candidate content with a bounded exact reference would materially reduce usefulness for the ongoing mission.',
  unresolved_evidence:
    'Estimate whether this candidate warrants conservative review because it contains unresolved failure, warning, contradiction, dependency, verification, or materially incomplete evidence. This is advisory and is not proof of contradiction.',
};

export const SYSTEM_ONE_SENSOR_V2_PROGRAM_DIGEST =
  sha256Digest(JSON.stringify({
    schema: 'anvil.system-one-sensor-program.v2',
    axes: SEMANTIC_SENSOR_AXES_V2,
    instructions: AXIS_INSTRUCTIONS,
    recoverability: 'mechanical-only',
  }));

export interface SystemOneSensorV2HTTPResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type SystemOneSensorV2Fetch = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
  },
) => Promise<SystemOneSensorV2HTTPResponse>;

export interface SystemOneSensorV2EgressGrant {
  schema: 'anvil.system-one-sensor-v2-egress-grant.v1';
  scope: 'synthetic_fixture';
  request_digest: string;
}

export interface SystemOneSensorV2ProviderOptions {
  apiKey: string;
  model: string;
  egressGrants?: readonly SystemOneSensorV2EgressGrant[];
  baseUrl?: string;
  fetch?: SystemOneSensorV2Fetch;
}

export interface SystemOneSensorV2ProviderMetadata {
  requested_model: string;
  effective_model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: null;
}

export interface SystemOneSensorV2Result {
  schema: 'anvil.system-one-sensor-result.v2';
  request_id: string;
  observations: readonly SemanticSensorObservationV2[];
  provider_metadata: SystemOneSensorV2ProviderMetadata;
}

type SystemOneAnswer = { noul?: unknown };

function assertPinnedModel(model: string): void {
  if (!PINNED_JEV_MODEL.test(model)) {
    throw new Error(
      'System One sensor v2 requires an exact pinned Jev model identity',
    );
  }
}

function questionKey(
  candidateID: string,
  axis: SemanticSensorAxisV2,
): string {
  return `${candidateID}.${axis}`;
}

function finiteProbability(
  answer: SystemOneAnswer | undefined,
  key: string,
): number {
  const value = answer?.noul;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new Error(
      `System One returned invalid noul answer for ${key}`,
    );
  }
  return value;
}

function optionalUsage(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : null;
}

function defaultFetch(): SystemOneSensorV2Fetch {
  return async (url, init) => {
    const response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
    });
    return {
      ok: response.ok,
      status: response.status,
      text: () => response.text(),
    };
  };
}

function buildQuestions(request: MappedDecisionRequest): Record<string, {
  type: 'noul';
  instructions: string;
  criteria: { true: string; false: string };
}> {
  const questions: Record<string, {
    type: 'noul';
    instructions: string;
    criteria: { true: string; false: string };
  }> = {};

  for (const candidate of request.candidate_views) {
    for (const axis of SEMANTIC_SENSOR_AXES_V2) {
      questions[questionKey(candidate.candidate_id, axis)] = {
        type: 'noul',
        instructions:
          `${AXIS_INSTRUCTIONS[axis]} Candidate ID: ${candidate.candidate_id}.`,
        criteria: {
          true: 'The predicate applies.',
          false: 'The predicate does not apply.',
        },
      };
    }
  }
  return questions;
}

export function systemOneSensorV2RequestDigest(
  request: MappedDecisionRequest,
): string {
  return sha256Digest(JSON.stringify({
    schema: 'anvil.system-one-sensor-request-binding.v2',
    program_digest: SYSTEM_ONE_SENSOR_V2_PROGRAM_DIGEST,
    request,
  }));
}

export function authorizeSyntheticSensorV2Egress(
  request: MappedDecisionRequest,
): SystemOneSensorV2EgressGrant {
  const validation = validateMappedDecisionRequest(request);
  if (!validation.ok) {
    throw new Error(
      `Cannot authorize invalid sensor v2 request: ${validation.code}`,
    );
  }
  if (!request.source_run_id.startsWith('fixture-')) {
    throw new Error(
      'System One sensor v2 egress grants are restricted to synthetic fixture requests',
    );
  }
  return Object.freeze({
    schema: 'anvil.system-one-sensor-v2-egress-grant.v1' as const,
    scope: 'synthetic_fixture' as const,
    request_digest: systemOneSensorV2RequestDigest(request),
  });
}

export function createSystemOneSensorV2Provider(
  options: SystemOneSensorV2ProviderOptions,
): (request: MappedDecisionRequest) => Promise<SystemOneSensorV2Result> {
  if (!options.apiKey) {
    throw new Error(
      'System One sensor v2 requires an API key at execution time',
    );
  }
  assertPinnedModel(options.model);

  const fetcher = options.fetch ?? defaultFetch();
  const endpoint = options.baseUrl ?? SYSTEM_ONE_SENSOR_V2_ENDPOINT;
  const grants = new Set(
    (options.egressGrants ?? [])
      .filter((grant) =>
        grant.schema === 'anvil.system-one-sensor-v2-egress-grant.v1' &&
        grant.scope === 'synthetic_fixture')
      .map((grant) => grant.request_digest),
  );

  return async (request: MappedDecisionRequest) => {
    const validation = validateMappedDecisionRequest(request);
    if (!validation.ok) {
      throw new Error(
        `System One sensor v2 mapped request invalid: ${validation.code}`,
      );
    }

    const requestDigest = systemOneSensorV2RequestDigest(request);
    if (!grants.has(requestDigest)) {
      throw new Error(
        'System One sensor v2 egress grant does not authorize this exact request',
      );
    }

    const questions = buildQuestions(request);
    const expectedKeys = Object.keys(questions);

    const body = JSON.stringify({
      model: options.model,
      state: {
        schema: SYSTEM_ONE_SENSOR_V2_STATE_SCHEMA,
        program_digest: SYSTEM_ONE_SENSOR_V2_PROGRAM_DIGEST,
        shared_conversation_state: request.shared_conversation_state,
        candidate_views: request.candidate_views,
      },
      questions,
    });

    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`System One request failed (${response.status})`);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(await response.text());
    } catch {
      throw new Error('System One returned malformed JSON');
    }

    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      parsed.answers === null ||
      typeof parsed.answers !== 'object' ||
      Array.isArray(parsed.answers)
    ) {
      throw new Error('System One response is missing answers');
    }

    if (
      typeof parsed.model === 'string' &&
      parsed.model !== options.model
    ) {
      throw new Error(
        'System One effective model does not match the pinned model',
      );
    }

    const actualKeys = Object.keys(parsed.answers);
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key) =>
        !Object.prototype.hasOwnProperty.call(questions, key))
    ) {
      throw new Error(
        'System One answer key set does not exactly match the four-axis sensor contract',
      );
    }

    const observations = request.candidate_views.map(
      (candidate, originalOrdinal): SemanticSensorObservationV2 => ({
        schema: SEMANTIC_SENSOR_ABI_V2_SCHEMA,
        candidateId: candidate.candidate_id,
        originalOrdinal,
        sourceDigest: candidate.source_digest,
        programDigest: SYSTEM_ONE_SENSOR_V2_PROGRAM_DIGEST,
        evidenceSufficient: finiteProbability(
          parsed.answers[
            questionKey(candidate.candidate_id, 'evidence_sufficient')
          ],
          questionKey(candidate.candidate_id, 'evidence_sufficient'),
        ),
        predicates: {
          stillNeeded: finiteProbability(
            parsed.answers[
              questionKey(candidate.candidate_id, 'still_needed')
            ],
            questionKey(candidate.candidate_id, 'still_needed'),
          ),
          fullContentNeeded: finiteProbability(
            parsed.answers[
              questionKey(candidate.candidate_id, 'full_content_needed')
            ],
            questionKey(candidate.candidate_id, 'full_content_needed'),
          ),
          unresolvedEvidence: finiteProbability(
            parsed.answers[
              questionKey(candidate.candidate_id, 'unresolved_evidence')
            ],
            questionKey(candidate.candidate_id, 'unresolved_evidence'),
          ),
        },
        telemetry: {
          entropy: null,
          margin: null,
        },
      }),
    );

    return Object.freeze({
      schema: 'anvil.system-one-sensor-result.v2' as const,
      request_id: request.request_id,
      observations: Object.freeze(observations),
      provider_metadata: Object.freeze({
        requested_model: options.model,
        effective_model:
          typeof parsed.model === 'string'
            ? parsed.model
            : options.model,
        input_tokens: optionalUsage(parsed.usage?.input_tokens),
        output_tokens: optionalUsage(parsed.usage?.output_tokens),
        cost_usd: null,
      }),
    });
  };
}
