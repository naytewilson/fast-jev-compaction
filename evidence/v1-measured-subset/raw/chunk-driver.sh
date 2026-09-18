#!/bin/sh
cd /Users/nayte/ane-hot/workspace/lfm-family-neo-validation/tools/causal-stepper
for c in 00 01 02 03; do
  .build/debug/CausalStepperMac score \
    --packages /Users/nayte/ane-hot/models/lfm25-2p6b-d1p1/compiled \
    --embed /Users/nayte/ane-hot/models/lfm25-2p6b-d1p1/embed_weight.bin \
    --fixture /Users/nayte/semantic-fabric/chunk-$c.jsonl \
    --probe-ids 11683,12447,18171,17550,2243,4547,794,2752 \
    --compute-units all >> /tmp/csm_score3.log 2>>/tmp/csm_score3.err
  echo "CHUNK_$c DONE rc=$?" >> /tmp/csm_score3.err
done
echo ALL_CHUNKS_DONE >> /tmp/csm_score3.err
