// tokenize-manifest.mjs — noul-manifest.jsonl -> noul-ids.jsonl
// Pads each prompt to an exact multiple of 16 real tokens by inserting
// single-token "." filler inside the system section (never KV pads —
// every inserted token is real prompt content).
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Tokenizer } from "tokenizers";

const [inPath, tokPath, outPath] = process.argv.slice(2);
if (!inPath || !tokPath || !outPath) {
  console.error("usage: node tokenize-manifest.mjs <manifest.jsonl> <tokenizer.json> <out.jsonl>");
  process.exit(2);
}
const tok = await Tokenizer.fromFile(tokPath);
const DOT = 22;          // verified: "." encodes to exactly token 22
const AXES = ["evidence_sufficient","still_needed","full_content_needed","unresolved_evidence","recoverable"];

const rows = readFileSync(inPath, "utf8").split("\n").filter(l => l.trim());
const out = [];
let totalTokens = 0;
for (const line of rows) {
  const row = JSON.parse(line);
  for (const axis of AXES) {
    const text = row.prompts[axis];
    const ids = (await tok.encode(text)).getIds();
    const pad = (16 - (ids.length % 16)) % 16;
    // splice filler after "<|im_start|>system\n" (first 3 tokens)
    const padded = [...ids.slice(0, 3), ...Array(pad).fill(DOT), ...ids.slice(3)];
    if (padded.length % 16 !== 0) throw new Error("pad math failed");
    totalTokens += padded.length;
    out.push(JSON.stringify({
      schema: "anvil.noul-ids.v1",
      requestId: row.requestId,
      traceId: row.traceId,
      candidateId: row.candidateId,
      axis,
      candidateViewDigest: row.candidateViewDigest,
      sourceDigest: row.sourceDigest,
      promptTokens: padded.length,
      promptDigest: "sha256:" + createHash("sha256").update(JSON.stringify(padded)).digest("hex"),
      prompt_ids: padded,
    }));
  }
}
writeFileSync(outPath, out.join("\n") + "\n");
console.log(`rows=${out.length} totalTokens=${totalTokens} -> ${outPath}`);
