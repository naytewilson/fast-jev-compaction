import type {
  AuthorityRegistry,
  AuthorityRouteGrant,
} from './authority-registry.js';

export type AuthorityRouteKind =
  | 'primary'
  | 'hydrate'
  | 'pristine'
  | 'compatible-profile'
  | 'alternate-provider'
  | 'unoptimized';

export interface AuthorityRoutingRequest {
  requestId: string;
  sourceLineageDigest: string;
  routeGeneration: number;
  primaryRouteId: string;
  evidenceDeficit: boolean;
  mechanicalRecoveryAvailable: boolean;
  pristineAvailable: boolean;
  compatibleProfileRouteIds: string[];
  alternateProviderRouteIds: string[];
}

export interface AuthorityRoutingDecision {
  requestId: string;
  sourceLineageDigest: string;
  routeGeneration: number;
  route: AuthorityRouteKind;
  routeId: string | null;
  previousAuthorityIdentity: string | null;
  effectiveAuthorityIdentity: string | null;
  reason: string;
  taskContinues: true;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;

function validGeneration(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateRouteId(value: string, field: string): void {
  if (value.length === 0 || value.includes('\0')) {
    throw new TypeError(`${field} must be non-empty and NUL-free`);
  }
}

function validateRequest(request: AuthorityRoutingRequest): void {
  if (request.requestId.length === 0 || request.requestId.includes('\0')) {
    throw new TypeError('requestId must be non-empty and NUL-free');
  }
  if (!DIGEST.test(request.sourceLineageDigest)) {
    throw new TypeError('sourceLineageDigest must be canonical sha256');
  }
  if (!validGeneration(request.routeGeneration)) {
    throw new TypeError('routeGeneration must be a non-negative safe integer');
  }
  validateRouteId(request.primaryRouteId, 'primaryRouteId');
  for (const [field, ids] of [
    ['compatibleProfileRouteIds', request.compatibleProfileRouteIds],
    ['alternateProviderRouteIds', request.alternateProviderRouteIds],
  ] as const) {
    const seen = new Set<string>();
    for (const id of ids) {
      validateRouteId(id, field);
      if (seen.has(id)) throw new Error(`${field} contains duplicate route id ${id}`);
      seen.add(id);
    }
  }
}

function decision(
  request: AuthorityRoutingRequest,
  route: AuthorityRouteKind,
  grant: AuthorityRouteGrant | null,
  reason: string,
): AuthorityRoutingDecision {
  return Object.freeze({
    requestId: request.requestId,
    sourceLineageDigest: request.sourceLineageDigest,
    routeGeneration: request.routeGeneration,
    route,
    routeId: grant?.routeId ?? null,
    previousAuthorityIdentity: null,
    effectiveAuthorityIdentity: grant?.authorityIdentity ?? null,
    reason,
    taskContinues: true as const,
  });
}

function firstResolved(
  ids: readonly string[],
  request: AuthorityRoutingRequest,
  registry: AuthorityRegistry,
): AuthorityRouteGrant | null {
  for (const id of ids) {
    const grant = registry.resolve(id, request.sourceLineageDigest);
    if (grant !== null) return grant;
  }
  return null;
}

export function selectAuthorityRoute(
  request: AuthorityRoutingRequest,
  registry: AuthorityRegistry,
): AuthorityRoutingDecision {
  validateRequest(request);

  const primary = registry.resolve(request.primaryRouteId, request.sourceLineageDigest);
  if (primary !== null) {
    return decision(request, 'primary', primary, 'primary-authority-valid');
  }

  if (request.evidenceDeficit && request.mechanicalRecoveryAvailable) {
    return decision(request, 'hydrate', null, 'recoverable-evidence-deficit');
  }

  if (request.pristineAvailable) {
    return decision(request, 'pristine', null, 'semantic-authority-degraded');
  }

  const compatible = firstResolved(
    request.compatibleProfileRouteIds,
    request,
    registry,
  );
  if (compatible !== null) {
    return decision(
      request,
      'compatible-profile',
      compatible,
      'compatible-authority-valid',
    );
  }

  const alternate = firstResolved(
    request.alternateProviderRouteIds,
    request,
    registry,
  );
  if (alternate !== null) {
    return decision(
      request,
      'alternate-provider',
      alternate,
      'alternate-authority-valid',
    );
  }

  return decision(request, 'unoptimized', null, 'no-semantic-authority-route');
}

export function handoffAuthority(
  previous: AuthorityRoutingDecision,
  next: AuthorityRoutingDecision,
  reason: string,
): AuthorityRoutingDecision {
  if (
    previous.requestId !== next.requestId ||
    previous.sourceLineageDigest !== next.sourceLineageDigest
  ) {
    throw new Error('authority handoff lineage mismatch');
  }
  if (!validGeneration(previous.routeGeneration) || previous.routeGeneration === Number.MAX_SAFE_INTEGER) {
    throw new RangeError('authority route generation exhausted');
  }
  if (reason.length === 0) throw new TypeError('handoff reason must be non-empty');

  return Object.freeze({
    ...next,
    routeGeneration: previous.routeGeneration + 1,
    previousAuthorityIdentity: previous.effectiveAuthorityIdentity,
    reason,
    taskContinues: true as const,
  });
}
