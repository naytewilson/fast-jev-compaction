import {
  MODELED_SEMANTIC_AXES_V2,
  SEMANTIC_DECISION_RESPONSE_SCHEMA_V2,
  validateSemanticDecisionRequestV2,
  type ModeledSemanticAxisV2,
  type SemanticCandidateObservationV2,
  type SemanticDecisionRequestV2,
  type SemanticDecisionResponseV2,
} from './semantic-contract-v2.js';
import { sha256Digest } from './recovery.js';
import type {
  SystemOneFetch,
  SystemOneHTTPResponse,
  SystemOneProviderMetadata,
} from './system-one-adapter.js';

export type { SemanticDecisionRequestV2 } from './semantic-contract-v2.js';
export type { SystemOneFetch, SystemOneHTTPResponse } from './system-one-adapter.js';

export const SYSTEM_ONE_SEMANTIC_ENDPOINT_V2 =
  'https://api.typesafe.ai/v1/systemone';
export const SYSTEM_ONE_SEMANTIC_STATE_SCHEMA_V2 =
  'anvil.system-one-semantic-state.v2';

const PINNED_JEV_MODEL = /^jev-\d+\.\d+\.\d+$/;

const AXIS_INSTRUCTIONS: Record<ModeledSemanticAxisV2, string> = {
  evidence_sufficient:
    'Estimate whether the bounded candidate view and shared state are sufficient to judge this exact candidate for the active mission. Stale, missing, truncated, task-mismatched, or orthogonal evidence should reduce this score.',
  still_needed:
    'Estimate whether this exact source-bound candidate carries information likely needed for the active mission.',
  full_content_needed:
    'Estimate whether replacing omitted source content with an exact reversible reference would materially reduce usefulness for the active mission.',
  unresolved_evidence:
    'Estimate whether the candidate contains evidence that merits review because of an unresolved failure, warning, dependency, verification gap, or contradiction. Missing evidence alone is not sufficient to establish this predicate.',
};

export interface SystemOneSemanticEgressGrantV2 {
  schema: 'anvil.system-one-egress-grant.v1';
  scope: 'synthetic_fixture';
  request_digest: string;
}

export interface SystemOneSemanticProviderV2Options {
  apiKey: string;
  model: string;
  egressGrants?: readonly SystemOneSemanticEgressGrantV2[];
  baseUrl?: string;
  fetch?: SystemOneFetch;
}

export interface SystemOneSemanticProviderV2Result {
  mapped_response: SemanticDecisionResponseV2;
  provider_metadata: SystemOneProviderMetadata;
}

type SystemOneAnswer = {
  type?: string;
  noul?: unknown;
};

export function systemOneSemanticRequestDigestV2(
  request: SemanticDecisionRequestV2,
): string {
  return sha256Digest(JSON.stringify(request));
}

export function authorizeSyntheticFixtureEgressV2(
  request: SemanticDecisionRequestV2,
): SystemOneSemanticEgressGrantV2 {
  const validation = validateSemanticDecisionRequestV2(request);
  if (!validation.ok) {
    throw new Error(
      `Cannot authorize invalid semantic v2 request: ${validation.code}`,
    );
  }
  if (!request.source_run_id.startsWith('fixture-')) {
    throw new Error(
      'System One semantic v2 egress grants are restricted to synthetic fixture requests',
    );
  }
  return Object.freeze({
    schema: 'anvil.system-one-egress-grant.v1' as const,
    scope: 'synthetic_fixture' as const,
    request_digest: systemOneSemanticRequestDigestV2(request),
  });
}

function assertPinnedModel(model: string): void {
  if (!PINNED_JEV_MODEL.test(model)) {
    throw new Error(
      'System One semantic v2 adapter requires an exact pinned Jev model identity',
    );
  }
}

function questionKey(
  candidateID: string,
  axis: ModeledSemanticAxisV2,
): string {
  return `${candidateID}.${axis}`;
}

function buildQuestions(
  request: SemanticDecisionRequestV2,
): Record<string, {
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
    for (const axis of MODELED_SEMANTIC_AXES_V2) {
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

function defaultFetch(): SystemOneFetch {
  return async (url, init): Promise<SystemOneHTTPResponse> => {
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

export function createSystemOneSemanticProviderV2(
  options: SystemOneSemanticProviderV2Options,
): (
  request: SemanticDecisionRequestV2,
) => Promise<SystemOneSemanticProviderV2Result> {
  if (!options.apiKey) {
    throw new Error(
      'System One semantic v2 adapter requires an API key at execution time',
    );
  }
  assertPinnedModel(options.model);

  const fetcher = options.fetch ?? defaultFetch();
  const endpoint = options.baseUrl ?? SYSTEM_ONE_SEMANTIC_ENDPOINT_V2;
  const grantedDigests = new Set(
    (options.egressGrants ?? [])
      .filter((grant) =>
        grant.schema === 'anvil.system-one-egress-grant.v1' &&
        grant.scope === 'synthetic_fixture')
      .map((grant) => grant.request_digest),
  );

  return async (
    request: SemanticDecisionRequestV2,
  ): Promise<SystemOneSemanticProviderV2Result> => {
    const validation = validateSemanticDecisionRequestV2(request);
    if (!validation.ok) {
      throw new Error(
        `System One semantic v2 request invalid: ${validation.code}`,
      );
    }

    const requestDigest = systemOneSemanticRequestDigestV2(request);
    if (!grantedDigests.has(requestDigest)) {
      throw new Error(
        'System One egress grant does not authorize this exact semantic v2 request',
      );
    }

    const questions = buildQuestions(request);
    const expectedKeys = Object.keys(questions);
    const body = JSON.stringify({
      model: options.model,
      state: {
        schema: SYSTEM_ONE_SEMANTIC_STATE_SCHEMA_V2,
        semantic_program: request.semantic_program,
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
        'System One answer key set does not exactly match the semantic v2 contract',
      );
    }

    const observations: SemanticCandidateObservationV2[] =
      request.candidate_views.map((candidate) => {
        const values = Object.fromEntries(
          MODELED_SEMANTIC_AXES_V2.map((axis) => {
            const key = questionKey(candidate.candidate_id, axis);
            return [
              axis,
              { noul: finiteProbability(parsed.answers[key], key) },
            ];
          }),
        ) as Omit<SemanticCandidateObservationV2, 'candidate_id'>;

        return {
          candidate_id: candidate.candidate_id,
          ...values,
        };
      });

    return {
      mapped_response: {
        schema: SEMANTIC_DECISION_RESPONSE_SCHEMA_V2,
        request_id: request.request_id,
        observations,
      },
      provider_metadata: {
        requested_model: options.model,
        effective_model:
          typeof parsed.model === 'string'
            ? parsed.model
            : options.model,
        input_tokens: optionalUsage(parsed.usage?.input_tokens),
        output_tokens: optionalUsage(parsed.usage?.output_tokens),
        cost_usd: null,
      },
    };
  };
}
