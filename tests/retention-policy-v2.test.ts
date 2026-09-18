import { describe, expect, it } from 'vitest';
import {
  evaluateRetentionPolicyV2,
} from '../src/lab/retention-policy-v2.js';
import {
  MechanicalRecoveryAttestor,
} from '../src/lab/mechanical-recovery-v1.js';
import {
  InMemoryCAS,
  createToolRecoveryManifest,
  encodeToolEvidence,
} from '../src/lab/recovery.js';

const d = (c: string) => 'sha256:' + c.repeat(64);

function semanticFixture() {
  const stdout = 'head\ncritical\ntail';
  const stderr = '';
  const exitStatus = 0;
  const manifest = createToolRecoveryManifest(
    stdout,
    stderr,
    exitStatus,
    'policy-v2-object',
  );
  const identity = {
    candidateId: 'cand-0001',
    originalOrdinal: 0,
    sourceDigest: manifest.source_digest,
    programDigest: d('b'),
  };
  return { stdout, stderr, exitStatus, manifest, identity };
}

function observation(
  identity: ReturnType<typeof semanticFixture>['identity'],
  patch: Record<string, number> = {},
) {
  return {
    schema: 'anvil.semantic-observation-abi.v2' as const,
    ...identity,
    evidenceSufficient: patch.evidenceSufficient ?? 0.9,
    predicates: {
      stillNeeded: patch.stillNeeded ?? 0.9,
      fullContentNeeded: patch.fullContentNeeded ?? 0.1,
      unresolvedEvidence: patch.unresolvedEvidence ?? 0.1,
    },
    telemetry: { entropy: null, margin: null },
  };
}

function recovery(put = true) {
  const f = semanticFixture();
  const cas = new InMemoryCAS();
  if (put) {
    cas.put(
      'policy-v2-object',
      encodeToolEvidence(f.stdout, f.stderr, f.exitStatus),
    );
  }
  const attestation = new MechanicalRecoveryAttestor().attestTool({
    candidateId: f.identity.candidateId,
    manifest: f.manifest,
    stdout: f.stdout,
    stderr: f.stderr,
    exitStatus: f.exitStatus,
  }, cas);
  return {
    ...f,
    cas,
    attestation,
    snapshotDigest: cas.snapshotDigest(),
  };
}

const thresholds = {
  evidenceSufficientFloor: 0.5,
  retainFloor: 0.5,
  fullContentFloor: 0.8,
  unresolvedReviewFloor: 0.8,
};

describe('retention policy v2', () => {
  it('abstains before semantic retention decisions when evidence is insufficient', () => {
    const f = recovery(true);
    expect(evaluateRetentionPolicyV2(
      f.identity,
      observation(f.identity, { evidenceSufficient: 0.2 }),
      f.attestation,
      f.snapshotDigest,
      thresholds,
    )).toMatchObject({
      disposition: 'ABSTAIN',
      authorityGranted: false,
      reason: 'insufficient-evidence',
    });
  });

  it('uses still-needed then full-content-needed for retained evidence', () => {
    const f = recovery(true);

    expect(evaluateRetentionPolicyV2(
      f.identity,
      observation(f.identity, {
        stillNeeded: 0.9,
        fullContentNeeded: 0.1,
      }),
      f.attestation,
      f.snapshotDigest,
      thresholds,
    )).toMatchObject({
      disposition: 'REFERENTIAL',
      authorityGranted: true,
    });

    expect(evaluateRetentionPolicyV2(
      f.identity,
      observation(f.identity, {
        stillNeeded: 0.9,
        fullContentNeeded: 0.95,
      }),
      f.attestation,
      f.snapshotDigest,
      thresholds,
    )).toMatchObject({
      disposition: 'FULL',
      authorityGranted: false,
    });
  });

  it('treats unresolved evidence as review advice rather than proof of contradiction', () => {
    const f = recovery(true);
    expect(evaluateRetentionPolicyV2(
      f.identity,
      observation(f.identity, {
        stillNeeded: 0.1,
        fullContentNeeded: 0.1,
        unresolvedEvidence: 0.95,
      }),
      f.attestation,
      f.snapshotDigest,
      thresholds,
    )).toMatchObject({
      disposition: 'FULL',
      authorityGranted: false,
      reason: 'unresolved-evidence-review',
    });
  });

  it('evicts low-value resolved evidence only with a current VERIFIED mechanical attestation', () => {
    const verified = recovery(true);
    expect(evaluateRetentionPolicyV2(
      verified.identity,
      observation(verified.identity, {
        stillNeeded: 0.1,
        unresolvedEvidence: 0.1,
      }),
      verified.attestation,
      verified.snapshotDigest,
      thresholds,
    )).toMatchObject({
      disposition: 'EVICTED',
      authorityGranted: true,
    });

    const missing = recovery(false);
    expect(evaluateRetentionPolicyV2(
      missing.identity,
      observation(missing.identity, {
        stillNeeded: 0.1,
        unresolvedEvidence: 0.1,
      }),
      missing.attestation,
      missing.snapshotDigest,
      thresholds,
    )).toMatchObject({
      disposition: 'FULL',
      authorityGranted: false,
      reason: 'mechanical-recovery-unavailable',
    });
  });

  it('fails closed when a once-valid recovery attestation becomes stale', () => {
    const f = recovery(true);
    f.cas.put('later-object', 'changed-store');

    expect(evaluateRetentionPolicyV2(
      f.identity,
      observation(f.identity, {
        stillNeeded: 0.1,
        unresolvedEvidence: 0.1,
      }),
      f.attestation,
      f.cas.snapshotDigest(),
      thresholds,
    )).toMatchObject({
      disposition: 'FULL',
      authorityGranted: false,
      reason: 'stale-recovery-attestation',
    });
  });

  it('uses profile-supplied sufficiency thresholds instead of weak-experiment constants', () => {
    const f = recovery(true);
    const obs = observation(f.identity, { evidenceSufficient: 0.3 });

    expect(evaluateRetentionPolicyV2(
      f.identity,
      obs,
      f.attestation,
      f.snapshotDigest,
      { ...thresholds, evidenceSufficientFloor: 0.25 },
    ).disposition).toBe('REFERENTIAL');

    expect(evaluateRetentionPolicyV2(
      f.identity,
      obs,
      f.attestation,
      f.snapshotDigest,
      { ...thresholds, evidenceSufficientFloor: 0.5 },
    ).disposition).toBe('ABSTAIN');
  });
});
