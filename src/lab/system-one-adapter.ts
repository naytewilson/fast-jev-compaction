import {
  MAPPED_DECISION_RESPONSE_SCHEMA,
  MAPPED_OBSERVATION_AXES,
  type MappedCandidateObservation,
  type MappedDecisionRequest,
  type MappedDecisionResponse,
  type MappedObservationAxis,
} from './types.js';
import { validateMappedDecisionRequest } from './mapped-contract.js';
import { sha256Digest } from './recovery.js';

export const SYSTEM_ONE_MAPPED_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const SYSTEM_ONE_MAPPED_STATE_SCHEMA = 'anvil.system-one-mapped-state.v0';

const PINNED_JEV_MODEL = /^jev-\d+\.\d+\.\d+$/;

const AXIS_INSTRUCTIONS: Record<MappedObservationAxis, string> = {
  evidence_sufficient:
    'Estimate whether the bounded candidate view and shared conversation state are sufficient to make a retention judgment for the candidate identified by this question.',
  still_needed:
    'Estimate whether the candidate identified by this question carries information likely needed for the ongoing mission.',
  full_content_needed:
    'Estimate whether replacing omitted candidate content with a bounded reversible reference would materially reduce usefulness for the ongoing mission.',
  unresolved_evidence:
    'Estimate whether the candidate identified by this question contains unresolved failure, warning, contradiction, dependency, or verification evidence.',
  recoverable:
    'Estimate whether the candidate identified by this question appears recoverable through its declared exact recovery identity. This is semantic observation only and never substitutes for mechanical CAS verification.',
};

export interface SystemOneHTTPResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type SystemOneFetch = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
  },
) => Promise<SystemOneHTTPResponse>;

export interface SystemOneEgressGrant {
  schema: 'anvil.system-one-egress-grant.v0';
  scope: 'synthetic_fixture';
  request_digest: string;
}

export interface SystemOneMappedProviderOptions {
  apiKey: string;
  model: string;
  egressGrants?: readonly SystemOneEgressGrant[];
  baseUrl?: string;
  fetch?: SystemOneFetch;
}

export interface SystemOneProviderMetadata {
  requested_model: string;
  effective_model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: null;
}

export interface SystemOneMappedProviderResult {
  mapped_response: MappedDecisionResponse;
  provider_metadata: SystemOneProviderMetadata;
}

type SystemOneAnswer = {
  type?: string;
  noul?: unknown;
};

export interface SystemOneQuestion {
  type: 'noul';
  instructions: string;
  criteria: { true: string; false: string };
}

export interface SystemOneMappedPayload {
  model: string;
  state: {
    schema: typeof SYSTEM_ONE_MAPPED_STATE_SCHEMA;
    shared_conversation_state: MappedDecisionRequest['shared_conversation_state'];
    candidate_views: MappedDecisionRequest['candidate_views'];
  };
  questions: Record<string, SystemOneQuestion>;
}

export function systemOneMappedRequestDigest(request: MappedDecisionRequest): string {
  return sha256Digest(JSON.stringify(request));
}

export function authorizeSyntheticFixtureEgress(
  request: MappedDecisionRequest,
): SystemOneEgressGrant {
  const validation = validateMappedDecisionRequest(request);
  if (!validation.ok) {
    throw new Error(`Cannot authorize invalid mapped request: ${validation.code}`);
  }
  if (!request.source_run_id.startsWith('fixture-')) {
    throw new Error('System One egress grants are restricted to synthetic fixture requests');
  }
  return Object.freeze({
    schema: 'anvil.system-one-egress-grant.v0',
    scope: 'synthetic_fixture',
    request_digest: systemOneMappedRequestDigest(request),
  });
}

function assertPinnedModel(model: string): void {
  if (!PINNED_JEV_MODEL.test(model)) {
    throw new Error('System One mapped adapter requires an exact pinned Jev model identity');
  }
}

function questionKey(candidateID: string, axis: MappedObservationAxis): string {
  return `${candidateID}.${axis}`;
}

function validateAxisSubset(axes: readonly MappedObservationAxis[]): void {
  if (axes.length === 0) {
    throw new Error('System One axis subset must not be empty');
  }
  const registered = new Set<MappedObservationAxis>(MAPPED_OBSERVATION_AXES);
  const seen = new Set<MappedObservationAxis>();
  for (const axis of axes) {
    if (!registered.has(axis)) {
      throw new Error(`System One axis subset contains unknown axis ${axis}`);
    }
    if (seen.has(axis)) {
      throw new Error(`System One axis subset contains duplicate axis ${axis}`);
    }
    seen.add(axis);
  }
}

function buildQuestions(
  request: MappedDecisionRequest,
  axes: readonly MappedObservationAxis[],
): Record<string, SystemOneQuestion> {
  validateAxisSubset(axes);
  const questions: Record<string, SystemOneQuestion> = {};

  for (const candidate of request.candidate_views) {
    for (const axis of axes) {
      questions[questionKey(candidate.candidate_id, axis)] = {
        type: 'noul',
        instructions: `${AXIS_INSTRUCTIONS[axis]} Candidate ID: ${candidate.candidate_id}.`,
        criteria: {
          true: 'The predicate applies.',
          false: 'The predicate does not apply.',
        },
      };
    }
  }
  return questions;
}

export function buildSystemOneMappedPayload(
  request: MappedDecisionRequest,
  model: string,
  axes: readonly MappedObservationAxis[] = MAPPED_OBSERVATION_AXES,
): SystemOneMappedPayload {
  assertPinnedModel(model);
  const validation = validateMappedDecisionRequest(request);
  if (!validation.ok) {
    throw new Error(`Cannot build System One payload for invalid mapped request: ${validation.code}`);
  }

  return {
    model,
    state: {
      schema: SYSTEM_ONE_MAPPED_STATE_SCHEMA,
      shared_conversation_state: request.shared_conversation_state,
      candidate_views: request.candidate_views,
    },
    questions: buildQuestions(request, axes),
  };
}

function finiteProbability(answer: SystemOneAnswer | undefined, key: string): number {
  const value = answer?.noul;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new Error(`System One returned invalid noul answer for ${key}`);
  }
  return value;
}

function optionalUsage(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function defaultFetch(): SystemOneFetch {
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

export function createSystemOneMappedProvider(
  options: SystemOneMappedProviderOptions,
): (request: MappedDecisionRequest) => Promise<SystemOneMappedProviderResult> {
  if (!options.apiKey) {
    throw new Error('System One mapped adapter requires an API key at execution time');
  }
  assertPinnedModel(options.model);

  const fetcher = options.fetch ?? defaultFetch();
  const endpoint = options.baseUrl ?? SYSTEM_ONE_MAPPED_ENDPOINT;
  const grantedDigests = new Set(
    (options.egressGrants ?? [])
      .filter((grant) =>
        grant.schema === 'anvil.system-one-egress-grant.v0' &&
        grant.scope === 'synthetic_fixture')
      .map((grant) => grant.request_digest),
  );

  return async (request: MappedDecisionRequest): Promise<SystemOneMappedProviderResult> => {
    const requestDigest = systemOneMappedRequestDigest(request);
    if (!grantedDigests.has(requestDigest)) {
      throw new Error('System One egress grant does not authorize this exact mapped request');
    }

    const payload = buildSystemOneMappedPayload(request, options.model);
    const questions = payload.questions;
    const expectedKeys = Object.keys(questions);
    const body = JSON.stringify(payload);

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

    if (typeof parsed.model === 'string' && parsed.model !== options.model) {
      throw new Error('System One effective model does not match the pinned model');
    }

    const actualKeys = Object.keys(parsed.answers);
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key) => !Object.prototype.hasOwnProperty.call(questions, key))
    ) {
      throw new Error('System One answer key set does not exactly match the mapped contract');
    }

    const observations: MappedCandidateObservation[] = request.candidate_views.map((candidate) => {
      const values = Object.fromEntries(
        MAPPED_OBSERVATION_AXES.map((axis) => {
          const key = questionKey(candidate.candidate_id, axis);
          return [axis, { noul: finiteProbability(parsed.answers[key], key) }];
        }),
      ) as Omit<MappedCandidateObservation, 'candidate_id'>;

      return {
        candidate_id: candidate.candidate_id,
        ...values,
      };
    });

    return {
      mapped_response: {
        schema: MAPPED_DECISION_RESPONSE_SCHEMA,
        request_id: request.request_id,
        observations,
      },
      provider_metadata: {
        requested_model: options.model,
        effective_model: typeof parsed.model === 'string' ? parsed.model : options.model,
        input_tokens: optionalUsage(parsed.usage?.input_tokens),
        output_tokens: optionalUsage(parsed.usage?.output_tokens),
        cost_usd: null,
      },
    };
  };
}
