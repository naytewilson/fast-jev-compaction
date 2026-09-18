import { describe, expect, it } from 'vitest';
import { AuthorityRegistry, AuthorityRouteGrant } from '../src/lab/authority-registry.js';

const d = (c: string) => 'sha256:' + c.repeat(64);
const mask = (policy: boolean) => ({
  source: true,
  evidence: true,
  calibration: policy,
  authority: policy,
  recovery: true,
});

describe('AuthorityRegistry', () => {
  it('is the only issuer of policy-authoritative route grants', () => {
    const registry = new AuthorityRegistry();
    const grant = registry.register({
      routeId: 'jev-primary',
      calibrationIdentity: d('1'),
      authorityIdentity: d('2'),
      sourceLineageDigest: d('3'),
      authorityGeneration: 7,
      mask: mask(true),
    });

    expect(grant).toBeInstanceOf(AuthorityRouteGrant);
    expect(Object.isFrozen(grant)).toBe(true);
    expect(Object.isFrozen(grant.mask)).toBe(true);
    expect(registry.resolve('jev-primary', d('3'))).toBe(grant);
  });

  it('rejects registration that lacks policy authority', () => {
    const registry = new AuthorityRegistry();
    expect(() => registry.register({
      routeId: 'shadow',
      calibrationIdentity: d('1'),
      authorityIdentity: d('2'),
      sourceLineageDigest: d('3'),
      authorityGeneration: 1,
      mask: mask(false),
    })).toThrow(/policy authority/i);
  });

  it('fails resolution across source lineage', () => {
    const registry = new AuthorityRegistry();
    registry.register({
      routeId: 'jev-primary',
      calibrationIdentity: d('1'),
      authorityIdentity: d('2'),
      sourceLineageDigest: d('3'),
      authorityGeneration: 7,
      mask: mask(true),
    });
    expect(registry.resolve('jev-primary', d('4'))).toBeNull();
  });

  it('rejects duplicate route ids', () => {
    const registry = new AuthorityRegistry();
    const input = {
      routeId: 'jev-primary',
      calibrationIdentity: d('1'),
      authorityIdentity: d('2'),
      sourceLineageDigest: d('3'),
      authorityGeneration: 7,
      mask: mask(true),
    };
    registry.register(input);
    expect(() => registry.register(input)).toThrow(/duplicate route/i);
  });

  it('requires canonical identities', () => {
    const registry = new AuthorityRegistry();
    expect(() => registry.register({
      routeId: 'jev-primary',
      calibrationIdentity: 'sha256:BAD',
      authorityIdentity: d('2'),
      sourceLineageDigest: d('3'),
      authorityGeneration: 7,
      mask: mask(true),
    })).toThrow(/canonical sha256/i);
  });
});
