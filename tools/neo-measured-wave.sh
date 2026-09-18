#!/bin/sh
# neo-measured-wave.sh — measured-evidence wave driver.
#
#   tools/neo-measured-wave.sh <campaignDir> <score.log> <inventory.json> [cycles]
#
# End-to-end measured pipeline once the native score run has produced
# SCORE_END rows:
#   1. parse score log -> noul.jsonl (real per-axis probabilities)
#   2. extract observer wall-time samples
#   3. fault campaign over MEASURED records (subset-aware)
#   4. drift campaign over MEASURED records
#   5. provider comparison (measured arm)
#   6. hardware receipt with timingEvidence=measured
#
# Every step is fail-closed; artifacts land in <campaignDir>.
set -eu

DIR="${1:?campaignDir}"; LOG="${2:?score.log}"; INV="${3:?inventory.json}"
CYCLES="${4:-10000}"
NOUL="$DIR/noul-measured.jsonl"
SAMPLES="$DIR/observer-samples.json"

cd "$(dirname "$0")/.."

echo "== parse score log"
node tools/parse-score-log.mjs "$LOG" "$NOUL"

echo "== observer samples"
node tools/extract-observer-samples.mjs "$LOG" "$SAMPLES"

echo "== fault campaign (measured)"
npx tsx tools/neo-fault-campaign.ts "$DIR" "$NOUL" "$INV" "$CYCLES"

echo "== drift campaign (measured)"
npx tsx tools/neo-drift-campaign.ts "$DIR" "$NOUL" "$INV"

echo "== provider comparison (measured arm)"
npx tsx tools/neo-provider-comparison.ts "$DIR" "$NOUL" "$INV"

echo "== hardware receipt (measured)"
COMMIT="$(git rev-parse HEAD)"
npx tsx tools/neo-hardware-receipt.ts "$DIR" "$INV" \
  --observer-samples "$SAMPLES" --commit "$COMMIT"

echo "DONE — measured wave artifacts in $DIR"
