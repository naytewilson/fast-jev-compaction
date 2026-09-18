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
  schema: 'anvil.registered-semantic-program.v1';
  id: 'anvil.context-retention.v1';
  version: '1.0.0';
  decisionContract: ProfileIdentity;
  observationABIVersion: 'anvil.semantic-observation-abi.v1';
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
    'The candidate contains unresolved failure, warning, contradiction, dependency, or verification evidence.',
  recoverable:
    'The candidate appears semantically recoverable through its declared identity; mechanical recovery remains separately authoritative.',
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
    schema: 'anvil.registered-semantic-program.v1' as const,
    id: 'anvil.context-retention.v1' as const,
    version: '1.0.0' as const,
    decisionContract: contract,
    observationABIVersion: 'anvil.semantic-observation-abi.v1' as const,
    predicates,
  };

  return Object.freeze({
    ...core,
    predicates: Object.freeze(predicates),
    programDigest: sha256Digest(JSON.stringify(core)),
  });
}
