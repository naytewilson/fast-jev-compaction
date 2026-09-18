import {
  deriveSemanticCapabilities,
  type SemanticAuthorityMask,
} from './authority-mask.js';

export type AuthorityRouteKind =
  | 'primary'
  | 'hydrate'
  | 'pristine'
  | 'compatible-profile'
  | 'alternate-provider'
  | 'unoptimized';

export interface AuthorityRouteCandidate {
  id: string;
  authorityIdentity: string;
  mask: SemanticAuthorityMask;
}

export interface AuthorityRoutingRequest {
  requestId: string;
  sourceLineageDigest: string;
  routeGeneration: number;
  primary: AuthorityRouteCandidate;
  evidenceDeficit: boolean;
  mechanicalRecoveryAvailable: boolean;
  pristineAvailable: boolean;
  compatibleProfiles: AuthorityRouteCandidate[];
  alternateProviders: AuthorityRouteCandidate[];
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

function validGeneration(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function authoritative(candidate: AuthorityRouteCandidate): boolean {
  return deriveSemanticCapabilities(candidate.mask).mayDrivePolicy;
}

function decision(
  request: AuthorityRoutingRequest,
  route: AuthorityRouteKind,
  routeId: string | null,
  authorityIdentity: string | null,
  reason: string,
): AuthorityRoutingDecision {
  return Object.freeze({
    requestId: request.requestId,
    sourceLineageDigest: request.sourceLineageDigest,
    routeGeneration: request.routeGeneration,
    route,
    routeId,
    previousAuthorityIdentity: null,
    effectiveAuthorityIdentity: authorityIdentity,
    reason,
    taskContinues: true as const,
  });
}

export function selectAuthorityRoute(
  request: AuthorityRoutingRequest,
): AuthorityRoutingDecision {
  if (request.requestId.length === 0 || request.sourceLineageDigest.length === 0) {
    throw new TypeError('request/source lineage must be non-empty');
  }
  if (!validGeneration(request.routeGeneration)) {
    throw new TypeError('routeGeneration must be a non-negative safe integer');
  }

  if (authoritative(request.primary)) {
    return decision(
      request,
      'primary',
      request.primary.id,
      request.primary.authorityIdentity,
      'primary-authority-valid',
    );
  }

  if (request.evidenceDeficit && request.mechanicalRecoveryAvailable) {
    return decision(request, 'hydrate', null, null, 'recoverable-evidence-deficit');
  }

  if (request.pristineAvailable) {
    return decision(request, 'pristine', null, null, 'semantic-authority-degraded');
  }

  const compatible = request.compatibleProfiles.find(authoritative);
  if (compatible !== undefined) {
    return decision(
      request,
      'compatible-profile',
      compatible.id,
      compatible.authorityIdentity,
      'compatible-authority-valid',
    );
  }

  const alternate = request.alternateProviders.find(authoritative);
  if (alternate !== undefined) {
    return decision(
      request,
      'alternate-provider',
      alternate.id,
      alternate.authorityIdentity,
      'alternate-authority-valid',
    );
  }

  return decision(request, 'unoptimized', null, null, 'no-semantic-authority-route');
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
