// live-jev.ts — bounded live System One executor for the ABI battery.
//
// Reuses the controller's pure payload/parse seam and the lab egress grant.
// Retry policy mirrors anvil-jev-decisiond: only 429/529 retried (bounded
// exponential backoff, Retry-After honored ≤60s), 30s timeout, 4 attempts.
// Fail-closed: invalid request, missing grant, malformed response, model
// drift, and non-2xx terminal status all produce a typed error result —
// never a fabricated observation.

import { readFileSync } from 'node:fs';
import {
  authorizeSyntheticFixtureEgress,
  SYSTEM_ONE_MAPPED_ENDPOINT,
} from '../../src/lab/system-one-adapter.js';
import {
  buildSystemOneAxisExperimentPayload,
  parseSystemOneAxisExperimentResponse,
  type AxisExperimentObservation,
} from '../../src/lab/semantic-abi-experiment.js';
import { validateMappedDecisionRequest } from '../../src/lab/mapped-contract.js';
import { sha256Digest } from '../../src/lab/recovery.js';
import type { MappedDecisionRequest, MappedObservationAxis } from '../../src/lab/types.js';

export const JEV_MODEL = 'jev-1.13.0';
const MAX_ATTEMPTS = 4;
const TIMEOUT_MS = 30_000;
const MAX_RETRY_AFTER_MS = 60_000;
const RETRYABLE = new Set([429, 529]);

export interface LiveCallResult {
  ok: boolean;
  observations: readonly AxisExperimentObservation[] | null;
  metadata: {
    requested_model: string;
    effective_model: string;
    input_tokens: number | null;
    output_tokens: number | null;
    cost_usd: null;
  } | null;
  httpStatus: number | null;
  latencyMs: number;
  attempts: number;
  requestDigest: string;
  payloadDigest: string;
  payloadBytes: number;
  questionCount: number;
  responseDigest: string | null;
  responseText: string | null;
  errorCode: string | null;
  errorDetail: string | null;
}

export function loadApiKey(): string {
  const keyFile = process.env.TYPESAFE_API_KEY_FILE
    ?? `${process.env.HOME}/.local/share/anvil-jev-decisiond/typesafe-api-key`;
  const key = readFileSync(keyFile, 'utf8').trim();
  if (key.length < 8) throw new Error(`api key file ${keyFile} unreadable`);
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeLiveAxisCall(
  request: MappedDecisionRequest,
  model: string,
  axes: readonly MappedObservationAxis[],
  apiKey: string,
  endpoint: string = SYSTEM_ONE_MAPPED_ENDPOINT,
): Promise<LiveCallResult> {
  const requestDigest = sha256Digest(JSON.stringify(request));

  const validation = validateMappedDecisionRequest(request);
  if (!validation.ok) {
    return {
      ok: false, observations: null, metadata: null, httpStatus: null,
      latencyMs: 0, attempts: 0, requestDigest, payloadDigest: sha256Digest('invalid'),
      payloadBytes: 0, questionCount: 0, responseDigest: null, responseText: null,
      errorCode: `request:${validation.code}`, errorDetail: validation.detail,
    };
  }

  let grant;
  try {
    grant = authorizeSyntheticFixtureEgress(request);
  } catch (error) {
    return {
      ok: false, observations: null, metadata: null, httpStatus: null,
      latencyMs: 0, attempts: 0, requestDigest, payloadDigest: sha256Digest('denied'),
      payloadBytes: 0, questionCount: 0, responseDigest: null, responseText: null,
      errorCode: 'egress_denied', errorDetail: String(error),
    };
  }

  const payload = buildSystemOneAxisExperimentPayload(request, model, axes);
  const body = JSON.stringify(payload);
  const payloadDigest = sha256Digest(body);
  const questionCount = Object.keys(payload.questions).length;

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
          authorization: `Bearer ${apiKey}`,
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
    } catch (error) {
      lastText = null;
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(Math.min(500 * 2 ** (attempt - 1), 8000));
    }
  }
  const latencyMs = Date.now() - t0;

  if (lastStatus !== 200 || lastText === null) {
    return {
      ok: false, observations: null, metadata: null, httpStatus: lastStatus,
      latencyMs, attempts, requestDigest, payloadDigest,
      payloadBytes: body.length, questionCount,
      responseDigest: lastText !== null ? sha256Digest(lastText) : null,
      responseText: lastText,
      errorCode: lastStatus === null ? 'transport_failure' : `http_${lastStatus}`,
      errorDetail: lastText === null ? 'no response' : lastText.slice(0, 400),
    };
  }

  try {
    const parsed = parseSystemOneAxisExperimentResponse(request, model, axes, lastText);
    return {
      ok: true,
      observations: parsed.observations,
      metadata: parsed.providerMetadata,
      httpStatus: lastStatus,
      latencyMs, attempts, requestDigest, payloadDigest,
      payloadBytes: body.length, questionCount,
      responseDigest: sha256Digest(lastText),
      responseText: lastText,
      errorCode: null, errorDetail: null,
    };
  } catch (error) {
    return {
      ok: false, observations: null, metadata: null, httpStatus: lastStatus,
      latencyMs, attempts, requestDigest, payloadDigest,
      payloadBytes: body.length, questionCount,
      responseDigest: sha256Digest(lastText), responseText: lastText,
      errorCode: 'malformed_response', errorDetail: String(error).slice(0, 400),
    };
  }
}
