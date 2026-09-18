import {
  deriveSemanticCapabilities,
  type SemanticAuthorityMask,
} from './authority-mask.js';

export interface AuthorityRegistrationInput {
  routeId: string;
  calibrationIdentity: string;
  authorityIdentity: string;
  sourceLineageDigest: string;
  authorityGeneration: number;
  mask: SemanticAuthorityMask;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISSUER = Symbol('ANVIL.AuthorityRegistry.v1');

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) throw new TypeError(`${field} must be canonical sha256`);
}

function requireRouteId(value: string): void {
  if (value.length === 0 || value.includes('\0')) {
    throw new TypeError('routeId must be non-empty and NUL-free');
  }
}

export class AuthorityRouteGrant {
  private constructor(
    public readonly routeId: string,
    public readonly calibrationIdentity: string,
    public readonly authorityIdentity: string,
    public readonly sourceLineageDigest: string,
    public readonly authorityGeneration: number,
    public readonly mask: Readonly<SemanticAuthorityMask>,
  ) {
    Object.freeze(this);
  }

  static issue(
    issuer: symbol,
    input: AuthorityRegistrationInput,
  ): AuthorityRouteGrant {
    if (issuer !== ISSUER) {
      throw new Error('AuthorityRouteGrant may only be issued by AuthorityRegistry');
    }
    return new AuthorityRouteGrant(
      input.routeId,
      input.calibrationIdentity,
      input.authorityIdentity,
      input.sourceLineageDigest,
      input.authorityGeneration,
      Object.freeze({ ...input.mask }),
    );
  }
}

export class AuthorityRegistry {
  private readonly grants = new Map<string, AuthorityRouteGrant>();

  register(input: AuthorityRegistrationInput): AuthorityRouteGrant {
    requireRouteId(input.routeId);
    requireDigest(input.calibrationIdentity, 'calibrationIdentity');
    requireDigest(input.authorityIdentity, 'authorityIdentity');
    requireDigest(input.sourceLineageDigest, 'sourceLineageDigest');
    if (!Number.isSafeInteger(input.authorityGeneration) || input.authorityGeneration < 0) {
      throw new TypeError('authorityGeneration must be a non-negative safe integer');
    }
    if (!deriveSemanticCapabilities(input.mask).mayDrivePolicy) {
      throw new Error('route registration requires policy authority');
    }
    if (this.grants.has(input.routeId)) {
      throw new Error(`duplicate route id ${input.routeId}`);
    }

    const grant = AuthorityRouteGrant.issue(ISSUER, input);
    this.grants.set(input.routeId, grant);
    return grant;
  }

  resolve(routeId: string, sourceLineageDigest: string): AuthorityRouteGrant | null {
    requireRouteId(routeId);
    requireDigest(sourceLineageDigest, 'sourceLineageDigest');
    const grant = this.grants.get(routeId);
    if (grant === undefined || grant.sourceLineageDigest !== sourceLineageDigest) return null;
    return grant;
  }

  size(): number {
    return this.grants.size;
  }
}
