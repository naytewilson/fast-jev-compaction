import { readFileSync } from 'node:fs';
import { neoLfmIdentityV2 } from '../src/lab/noul-file-provider-v2.js';
const inv = JSON.parse(readFileSync('artifacts/neo-campaign/neo-inventory.json', 'utf8'));
const id = neoLfmIdentityV2({
  packageDigest: inv.packageDigest,
  tokenizerDigest: inv.tokenizerDigest,
  weightsDigest: inv.weightsDigest,
  quantization: inv.quantization,
  releaseId: inv.releaseId,
  backend: inv.backend,
  runtimeVersion: inv.runtimeVersion,
  compilerDigest: inv.compilerDigest,
  contextWindow: inv.contextWindow,
  samplingDigest: inv.samplingDigest,
  hardwareSemanticsClass: inv.hardwareSemanticsClass,
});
console.log('providerProfileDigest:', id.profile.providerProfileDigest);
console.log('normalizerDigest:', id.normalizerDigest);
console.log('observationABIDigest:', id.observationABIDigest);
console.log('axisSpecDigest:', id.axisSpecDigest);
console.log('modelIdentityDigest:', id.model.identityDigest);
console.log('executionSemanticsDigest:', id.semantics.identityDigest);
