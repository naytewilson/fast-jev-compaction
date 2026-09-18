import {
  verifyPromotedAuthorityCredential,
  type PromotedAuthorityCredential,
} from './promotion-credential.js';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const GRANT_TOKEN = Symbol('ANVIL.AuthorityRouteGrant.v2');

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) throw new TypeError(`${field} must be canonical sha256`);
}

function requireRouteId(value: string): void {
  if (value.length === 0 || value.includes('\0')) {
    throw new TypeError('routeId must be non-empty and NUL-free');
  }
}

export class AuthorityRouteGrant {
  public readonly calibrationAuthorized = true as const;
  public readonly policyProfileAuthorized = true as const;

  private constructor(
    token: symbol,
    public readonly routeId: string,
    public readonly providerId: string,
    public readonly providerProfileDigest: string,
    public readonly calibrationIdentity: string,
    public readonly authorityIdentity: string,
    public readonly policyProfileDigest: string,
    public readonly observationABIDigest: string,
    public readonly sourceLineageDigest: string,
    public readonly authorityGeneration: number,
    public readonly credentialDigest: string,
  ) {
    if (token !== GRANT_TOKEN) throw new Error('route grant is registry protected');
    Object.freeze(this);
  }

  static fromCredential(
    token: symbol,
    routeId: string,
    credential: PromotedAuthorityCredential,
  ): AuthorityRouteGrant {
    return new AuthorityRouteGrant(
      token,
      routeId,
      credential.providerId,
      credential.providerProfileDigest,
      credential.calibrationIdentity,
      credential.authorityIdentity,
      credential.policyProfileDigest,
      credential.observationABIDigest,
      credential.sourceLineageDigest,
      credential.authorityGeneration,
      credential.credentialDigest,
    );
  }
}

export class AuthorityRegistry {
  private readonly grants = new Map<string, AuthorityRouteGrant>();

  registerCredential(
    credential: PromotedAuthorityCredential,
  ): AuthorityRouteGrant {
    if (!verifyPromotedAuthorityCredential(credential)) {
      throw new Error('authority registry requires an issued promotion credential');
    }
    const routeId = `authority:${credential.providerId}:${credential.authorityGeneration}`;
    requireRouteId(routeId);
    if (this.grants.has(routeId)) {
      throw new Error(`duplicate route id ${routeId}`);
    }
    const grant = AuthorityRouteGrant.fromCredential(
      GRANT_TOKEN,
      routeId,
      credential,
    );
    this.grants.set(routeId, grant);
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
