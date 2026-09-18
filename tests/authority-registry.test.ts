import { describe, expect, it } from 'vitest';
import { AuthorityRegistry } from '../src/lab/authority-registry.js';
import { makeCredential, d } from './provider-authority-fixtures.js';

describe('AuthorityRegistry artifact-descended credential boundary', () => {
  it('registers an issued provider-bound credential', () => {
    const registry = new AuthorityRegistry();
    const { credential } = makeCredential();
    const grant = registry.registerCredential(credential);

    expect(grant.routeId).toBe('authority:typesafe-system-one/jev-1.13.0:7');
    expect(grant.providerProfileDigest).toBe(credential.providerProfileDigest);
    expect(grant.calibrationIdentity).toBe(credential.calibrationIdentity);
    expect(grant.calibrationAuthorized).toBe(true);
    expect(grant.policyProfileAuthorized).toBe(true);
    expect('mask' in grant).toBe(false);
    expect(registry.resolve(grant.routeId, d('7'))).toBe(grant);
  });

  it('rejects structural credential copies', () => {
    const registry = new AuthorityRegistry();
    const { credential } = makeCredential();
    expect(() => registry.registerCredential({ ...credential } as any))
      .toThrow(/issued promotion credential/i);
  });

  it('fails resolution across source lineage', () => {
    const registry = new AuthorityRegistry();
    const grant = registry.registerCredential(makeCredential().credential);
    expect(registry.resolve(grant.routeId, d('8'))).toBeNull();
  });

  it('rejects duplicate provider generation routes', () => {
    const registry = new AuthorityRegistry();
    registry.registerCredential(makeCredential().credential);
    expect(() => registry.registerCredential(makeCredential().credential))
      .toThrow(/duplicate route/i);
  });

  it('keeps providers in separate route namespaces', () => {
    const registry = new AuthorityRegistry();
    const jev = registry.registerCredential(makeCredential().credential);
    const qwen = registry.registerCredential(makeCredential('neo/qwen-ane').credential);
    expect(jev.routeId).not.toBe(qwen.routeId);
    expect(jev.providerProfileDigest).not.toBe(qwen.providerProfileDigest);
    expect(jev.calibrationIdentity).not.toBe(qwen.calibrationIdentity);
  });
});
