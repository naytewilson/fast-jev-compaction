// live-mercury.ts — Wave G second-provider executor: Inception Mercury 2 via
// the local agent gateway "rune" instance (127.0.0.1:8903), bearer auth, no
// SIEVE ingress requirement. OpenAI-compatible chat-completions wire.
//
// One chat completion per CallSpec request, mirroring live-jev.ts shape.
// The semantic question set uses the SAME canonical AXIS_INSTRUCTIONS
// wording as the System One arm so cross-provider deltas isolate provider
// behavior rather than prompt drift. Probabilities are model self-reports
// elicited under a strict JSON schema — recorded as a distinct execution
// semantic, never as provider-internal noul.
//
// Retry policy mirrors anvil-jev-decisiond: only 429/529 retried (bounded
// exponential backoff, Retry-After honored <=60s), 30s timeout, 4 attempts.
// Fail-closed: invalid request, non-fixture scope, transport failure,
// malformed/underspecified JSON, and out-of-range probabilities all produce
// typed error results — never a fabricated observation.

import { readFileSync } from 'node:fs';
import { AXIS_INSTRUCTIONS } from '../../src/lab/system-one-adapter.js';
import { validateMappedDecisionRequest } from '../../src/lab/mapped-contract.js';
import { sha256Digest } from '../../src/lab/recovery.js';
import type { AxisExperimentObservation } from '../../src/lab/semantic-abi-experiment.js';
import type { MappedDecisionRequest, MappedObservationAxis } from '../../src/lab/types.js';
import type { LiveCallResult } from './live-jev.js';

export const MERCURY_MODEL = 'mercury-2';
export const MERCURY_GATEWAY_URL = 'http://127.0.0.1:8903/v1/chat/completions';
const MAX_ATTEMPTS = 4;
const TIMEOUT_MS = 30_000;
const MAX_RETRY_AFTER_MS = 60_000;
const RETRYABLE = new Set([429, 529]);

export function loadMercuryBearer(): string {
  const keyFile = process.env.MERCURY_GATEWAY_BEARER_FILE
    ?? `${process.env.HOME}/.local/share/local-agent-gateway/rune/gateway-bearer`;
  const key = readFileSync(keyFile, 'utf8').trim();
  if (key.length < 8) throw new Error(`gateway bearer file ${keyFile} unreadable`);
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function failureResult(
  requestDigest: string,
  payloadDigest: string,
  payloadBytes: number,
  questionCount: number,
  httpStatus: number | null,
  latencyMs: number,
  attempts: number,
  responseText: string | null,
  errorCode: string,
  errorDetail: string | null,
): LiveCallResult {
  return {
    ok: false,
    observations: null,
    metadata: null,
    httpStatus,
    latencyMs,
    attempts,
    requestDigest,
    payloadDigest,
    payloadBytes,
    questionCount,
    responseDigest: responseText !== null ? sha256Digest(responseText) : null,
    responseText,
    errorCode,
    errorDetail,
  };
}

interface MercuryObservationRow {
  candidate_id: string;
  [axis: string]: unknown;
}

function parseObservations(
  request: MappedDecisionRequest,
  axes: readonly MappedObservationAxis[],
  responseText: string,
): AxisExperimentObservation[] {
  let parsed: any;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    // Robust extraction: model occasionally wraps JSON in prose or fences.
    const start = responseText.indexOf('{');
    const end = responseText.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new Error('mercury response is not JSON');
    }
    try {
      parsed = JSON.parse(responseText.slice(start, end + 1));
    } catch {
      throw new Error('mercury response JSON extraction failed');
    }
  }
  const content = parsed?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('mercury response missing choices[0].message.content');
  }
  let payload: any;
  try {
    payload = JSON.parse(content);
  } catch {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new Error('mercury message content is not JSON');
    }
    try {
      payload = JSON.parse(content.slice(start, end + 1));
    } catch {
      throw new Error('mercury message JSON extraction failed');
    }
  }
  if (!Array.isArray(payload?.observations)) {
    throw new Error('mercury payload missing observations array');
  }
  const expected = new Set(request.candidate_views.map((c) => c.candidate_id));
  const seen = new Set<string>();
  const out: AxisExperimentObservation[] = [];
  for (const row of payload.observations as MercuryObservationRow[]) {
    if (row === null || typeof row !== 'object' || typeof row.candidate_id !== 'string') {
      throw new Error('mercury observation row malformed');
    }
    if (!expected.has(row.candidate_id)) {
      throw new Error(`mercury returned unknown candidate ${row.candidate_id}`);
    }
    if (seen.has(row.candidate_id)) {
      throw new Error(`mercury returned duplicate candidate ${row.candidate_id}`);
    }
    seen.add(row.candidate_id);
    const values: Partial<Record<MappedObservationAxis, number>> = {};
    for (const axis of axes) {
      const v = row[axis];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`mercury ${row.candidate_id}.${axis} missing or outside [0,1]`);
      }
      values[axis] = v;
    }
    out.push({ candidateId: row.candidate_id, values });
  }
  if (seen.size !== expected.size) {
    throw new Error(`mercury observation cardinality ${seen.size} != expected ${expected.size}`);
  }
  return out;
}

function buildChatBody(
  request: MappedDecisionRequest,
  model: string,
  axes: readonly MappedObservationAxis[],
): string {
  const questions: unknown[] = [];
  for (const candidate of request.candidate_views) {
    for (const axis of axes) {
      questions.push({
        question_id: `${candidate.candidate_id}.${axis}`,
        candidate_id: candidate.candidate_id,
        axis,
        instructions: `${AXIS_INSTRUCTIONS[axis]} Candidate ID: ${candidate.candidate_id}.`,
        criteria: { true: 'The predicate applies.', false: 'The predicate does not apply.' },
      });
    }
  }
  const axisList = axes.map((a) => `"${a}"`).join(', ');
  const body = {
    model,
    messages: [
      {
        role: 'system',
        content:
          'You are a semantic observer in a source-bound evidence system. ' +
          'For each question you estimate the probability that the predicate applies to the named candidate. ' +
          'Answer ONLY a strict JSON object of the form ' +
          '{"observations":[{"candidate_id":"<id>",<axis>:<probability 0..1>, ...}]}. ' +
          'Every candidate must appear exactly once and every requested axis must be present as a finite number in [0,1]. No prose.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          shared_conversation_state: request.shared_conversation_state,
          candidate_views: request.candidate_views,
          questions,
          response_schema: {
            observations: [{ candidate_id: 'string', axes: `each of ${axisList} as number in [0,1]` }],
          },
        }),
      },
    ],
    response_format: { type: 'json_object' },
  };
  return JSON.stringify(body);
}

export async function executeMercuryAxisCall(
  request: MappedDecisionRequest,
  model: string,
  axes: readonly MappedObservationAxis[],
  bearerToken: string,
  endpoint: string = MERCURY_GATEWAY_URL,
): Promise<LiveCallResult> {
  const requestDigest = sha256Digest(JSON.stringify(request));

  const validation = validateMappedDecisionRequest(request);
  if (!validation.ok) {
    return failureResult(requestDigest, sha256Digest('invalid'), 0, 0, null, 0, 0, null,
      `request:${validation.code}`, validation.detail);
  }
  if (!request.source_run_id.startsWith('fixture-')) {
    return failureResult(requestDigest, sha256Digest('denied'), 0, 0, null, 0, 0, null,
      'egress_denied', 'mercury gateway route restricted to synthetic fixture requests');
  }

  const body = buildChatBody(request, model, axes);
  const payloadDigest = sha256Digest(body);
  const questionCount = request.candidate_views.length * axes.length;

  const t0 = Date.now();
  let lastStatus: number | null = null;
  let lastText: string | null = null;
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${bearerToken}`,
          'content-type': 'application/json',
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      lastStatus = response.status;
      lastText = await response.text();

      if (response.ok) break;
      if (!RETRYABLE.has(response.status)) break;
      const retryAfter = Number(response.headers.get('retry-after'));
      const wait = Number.isFinite(retryAfter)
        ? Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS)
        : Math.min(500 * 2 ** (attempt - 1), 8000);
      await sleep(wait);
    } catch {
      lastText = null;
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(Math.min(500 * 2 ** (attempt - 1), 8000));
    }
  }
  const latencyMs = Date.now() - t0;

  if (lastStatus !== 200 || lastText === null) {
    return failureResult(requestDigest, payloadDigest, body.length, questionCount,
      lastStatus, latencyMs, attempts, lastText,
      lastStatus === null ? 'transport_failure' : `http_${lastStatus}`,
      lastText === null ? 'no response' : lastText.slice(0, 400));
  }

  try {
    const observations = parseObservations(request, axes, lastText);
    let parsed: any = null;
    try { parsed = JSON.parse(lastText); } catch { /* parsed above */ }
    const usage = parsed?.usage ?? {};
    const optionalTokens = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
    return {
      ok: true,
      observations,
      metadata: {
        requested_model: model,
        effective_model: typeof parsed?.model === 'string' ? parsed.model : model,
        input_tokens: optionalTokens(usage.prompt_tokens),
        output_tokens: optionalTokens(usage.completion_tokens),
        cost_usd: null,
      },
      httpStatus: lastStatus,
      latencyMs,
      attempts,
      requestDigest,
      payloadDigest,
      payloadBytes: body.length,
      questionCount,
      responseDigest: sha256Digest(lastText),
      responseText: lastText,
      errorCode: null,
      errorDetail: null,
    };
  } catch (error) {
    return failureResult(requestDigest, payloadDigest, body.length, questionCount,
      lastStatus, latencyMs, attempts, lastText,
      'malformed_response', String(error).slice(0, 400));
  }
}
