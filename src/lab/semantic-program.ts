import {
  MAPPED_OBSERVATION_AXES,
  type MappedObservationAxis,
  type ProfileIdentity,
} from './types.js';
import { sha256Digest } from './recovery.js';

export interface RegisteredSemanticPredicate {
  id: MappedObservationAxis;
  requiresEvidenceSufficient: boolean;
  semanticDefinition: string;
}

export interface RegisteredSemanticProgram {
  schema: 'anvil.registered-semantic-program.v2';
  id: 'anvil.context-retention.v2';
  version: '2.0.0';
  decisionContract: ProfileIdentity;
  observationABIVersion: 'anvil.semantic-observation-abi.v2';
  predicates: readonly RegisteredSemanticPredicate[];
  programDigest: string;
}

const DEFINITIONS: Record<MappedObservationAxis, string> = {
  evidence_sufficient:
    'The bounded source view and shared state are sufficient to judge the registered retention predicates.',
  still_needed:
    'The source-bound candidate carries information likely needed for the active mission.',
  full_content_needed:
    'Replacing omitted source content with an exact reversible reference would materially reduce usefulness.',
  unresolved_evidence:
    'The candidate contains evidence whose interpretation, freshness, dependency state, failure status, contradiction status, or verification state still requires review.',
};

function frozenIdentity(identity: ProfileIdentity): ProfileIdentity {
  return Object.freeze({
    id: identity.id,
    version: identity.version,
    digest: identity.digest,
  });
}

export function compileContextRetentionProgram(
  decisionContract: ProfileIdentity,
): RegisteredSemanticProgram {
  const predicates = MAPPED_OBSERVATION_AXES.map((id) =>
    Object.freeze({
      id,
      requiresEvidenceSufficient: id !== 'evidence_sufficient',
      semanticDefinition: DEFINITIONS[id],
    }),
  );

  const contract = frozenIdentity(decisionContract);
  const core = {
    schema: 'anvil.registered-semantic-program.v2' as const,
    id: 'anvil.context-retention.v2' as const,
    version: '2.0.0' as const,
    decisionContract: contract,
    observationABIVersion: 'anvil.semantic-observation-abi.v2' as const,
    predicates,
  };

  return Object.freeze({
    ...core,
    predicates: Object.freeze(predicates),
    programDigest: sha256Digest(JSON.stringify(core)),
  });
}
