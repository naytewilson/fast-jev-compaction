// tokenize-manifest-v2.mjs — unified 4-probe prompt per candidate (V2).
//
// One prompt carries all four V2 axis questions; the assistant reply form
// "1= 2= 3= 4=" ends the prompt so each "=" marker is an answer slot.
// probes[] records the global token index of each marker — all inside the
// final 16-token window by construction.
//
// Vendored copy of the exact tokenizer pipeline used for the V2 measured
// subset — requires `tokenizers` (HF wasm bindings) + the LFM2.5
// tokenizer.json. Usage:
//   node tools/tokenize-manifest-v2.mjs <manifest.jsonl> <tokenizer.json> <out.jsonl>
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Tokenizer } from "tokenizers";

const [inPath, tokPath, outPath] = process.argv.slice(2);
if (!inPath || !tokPath || !outPath) {
  console.error("usage: tokenize-manifest-v2.mjs <manifest.jsonl> <tokenizer.json> <out.jsonl>");
  process.exit(2);
}
const tok = await Tokenizer.fromFile(tokPath);
const DOT = 22;
const AXES = ["evidence_sufficient", "still_needed", "full_content_needed", "unresolved_evidence"];
const MARKERS = ["1=", " 2=", " 3=", " 4="];

const rows = readFileSync(inPath, "utf8").split("\n").filter(l => l.trim());
const out = [];
let totalTokens = 0;
for (const line of rows) {
  const row = JSON.parse(line);
  if (row.schema !== "anvil.noul-manifest.v2") {
    throw new Error(`manifest row schema is not anvil.noul-manifest.v2 (${row.candidateId})`);
  }
  const promptAxes = Object.keys(row.prompts ?? {});
  if (promptAxes.some((a) => !AXES.includes(a)) || AXES.some((a) => !(a in row.prompts))) {
    throw new Error(`manifest row ${row.candidateId} prompts do not cover exactly the four V2 axes`);
  }
  const base = row.prompts.evidence_sufficient;
  const qi = base.indexOf("Question:");
  if (qi < 0) throw new Error("prompt missing Question line");
  const prefix = base.slice(0, qi);
  const questions = AXES.map((a, i) => {
    const p = row.prompts[a] ?? "";
    const m = p.match(/Question: (.+)/);
    return `${i + 1}. ${m ? m[1] : a}`;
  }).join("\n");
  const head = prefix +
    "Questions — answer Yes or No for each of the four:\n" + questions + "\n" +
    "Reply only in the form: 1=Yes/No 2=Yes/No 3=Yes/No 4=Yes/No\n" +
    "<|im_end|>\n<|im_start|>assistant\n";
  const idsHead = (await tok.encode(head)).getIds();
  const markerIds = [];
  for (const m of MARKERS) markerIds.push((await tok.encode(m)).getIds());
  let len = idsHead.length + markerIds.reduce((a, b) => a + b.length, 0);
  const pad = (16 - (len % 16)) % 16;
  const ids = [...idsHead.slice(0, 3), ...Array(pad).fill(DOT), ...idsHead.slice(3)];
  const probes = [];
  markerIds.forEach((seg, i) => {
    ids.push(...seg);
    probes.push({ axis: AXES[i], offset: ids.length - 1 });
  });
  if (ids.length % 16 !== 0) throw new Error("alignment failed");
  const lastWin = ids.length - 16;
  for (const p of probes) if (p.offset < lastWin) throw new Error(`probe ${p.axis} outside last window`);
  totalTokens += ids.length;
  out.push(JSON.stringify({
    schema: "anvil.noul-ids.v3",
    requestId: row.requestId,
    traceId: row.traceId,
    candidateId: row.candidateId,
    candidateViewDigest: row.candidateViewDigest,
    sourceDigest: row.sourceDigest,
    axisSpecDigest: row.axisSpecDigest,
    promptTokens: ids.length,
    promptDigest: "sha256:" + createHash("sha256").update(JSON.stringify(ids)).digest("hex"),
    probes,
    prompt_ids: ids,
  }));
}
writeFileSync(outPath, out.join("\n") + "\n");
console.log(`rows=${out.length} totalTokens=${totalTokens} -> ${outPath}`);
