// causal-stepper-regress — assert-style regression bank (repo convention).
//
// Proves the causal orchestration contract on Linux. Control: real
// CausalStepper over the canonical 30-layer 3x10 partition must audit
// clean AND deterministic. Mutants: each reconstructed historical defect
// must trip its named auditor check. A check that never fires is not
// evidence — every row below is a kill-switch for a specific past bug.

import CausalStepperCore
import CausalStepperMocks
import Foundation

var failures = 0
func check(_ cond: Bool, _ msg: String) {
    if !cond { failures += 1; FileHandle.standardError.write("FAIL: \(msg)\n".data(using: .utf8)!) }
    print("  \(cond ? "PASS" : "FAIL") \(msg)")
}

print("== DIAGNOSTICS: deterministic top-k ranking ==")
do {
    let ranked = topKLogits([0.1, 0.9, 0.9, -1.0], k: 3)
    check(ranked.map(\.id) == [1, 2, 0], "top-k orders by descending logit with token-id tie break")
    check(ranked.map(\.logit) == [0.9, 0.9, 0.1], "top-k preserves selected logits")
    check(topKLogits([0.2, 0.1], k: 0).isEmpty, "top-k disabled at k=0")
    check(topKLogits([0.2, 0.1], k: 8).map(\.id) == [0, 1], "top-k clamps to vocabulary size")
}

// ---------- canonical model geometry (frozen architecture truth) ----------
let geometry = ModelGeometry.lfm25_2p6b
let schedule = LayerSchedule.lfm25_2p6b
let partition = PartitionMap.lfm25_2p6b_3x10
let embedW = 16   // proven KVIO prefill window
let decodeW = 1   // strict per-token decode

func makeSegments() -> [SegmentID: SegmentAdapter] {
    var m: [SegmentID: SegmentAdapter] = [:]
    for seg in partition.orderedSegments {
        m[seg] = MockSegment(segment: seg, layers: partition.layersBySegment[seg] ?? [],
                             window: embedW, schedule: schedule, geometry: geometry)
    }
    return m
}

let prompt: [TokenID] = [1, 1, 6, 6423, 708, 58423, 916, 8544, 1235, 2359,
                         535, 2759, 523, 7, 708, 6, 64015, 708]   // canonical fixture prompt
let maxNew = 8

print("== CONTROL: real CausalStepper, canonical 3x10 ==")
let cfg = StepperConfig(schedule: schedule, geometry: geometry, partition: partition,
                        embedding: MockEmbedding(window: embedW),
                        segments: makeSegments(),
                        head: MockHead(window: decodeW),
                        prefillWindow: embedW, decodeContract: .strictSingleToken)
let stepper = try CausalStepper(config: cfg)
stepper.reset()
let r1 = try stepper.generate(prompt: prompt, maxNew: maxNew)
let audit1 = ContractAuditor.audit(trace: stepper.trace, partition: partition, schedule: schedule)
print(audit1.description)
check(audit1.passed, "control audit clean (0 violations, all checks pass)")
check(r1.generated.count == maxNew, "generated \(maxNew) tokens")
check(r1.generated.allSatisfy {
    if case .generated = $0.source { return true }; return false
}, "every produced token has .generated provenance")

// Determinism: fresh stepper, same config -> identical token stream.
let stepper2 = try CausalStepper(config: cfg)
stepper2.reset()
let r2 = try stepper2.generate(prompt: prompt, maxNew: maxNew)
check(r2.generated == r1.generated, "two fresh runs produce identical tokens (determinism)")

// Reset determinism: same stepper, reset -> identical stream, epoch 2 init.
stepper.reset()
let r3 = try stepper.generate(prompt: prompt, maxNew: maxNew)
check(r3.generated == r1.generated, "post-reset run reproduces identical tokens")
let audit3 = ContractAuditor.audit(trace: stepper.trace, partition: partition, schedule: schedule)
check(audit3.passed, "audit across two epochs stays clean")

// -- sabotage harness -------------------------------------------------------
func mutant(_ name: String, _ expectedCheck: String,
            _ run: (ExecutionTrace) -> Void) {
    let t = ExecutionTrace()
    run(t)
    let a = ContractAuditor.audit(trace: t, partition: partition, schedule: schedule)
    let tripped = a.checks.first { $0.id == expectedCheck }
    check(a.violations.contains { $0.check == expectedCheck } || (tripped?.passed == false),
          "\(name): check '\(expectedCheck)' fires")
    print("    -> \(a.violations.count) violation(s), first: \(a.violations.first?.detail.prefix(90) ?? "-")")
}

let segList = partition.orderedSegments.map {
    MockSegment(segment: $0, layers: partition.layersBySegment[$0] ?? [],
                window: embedW, schedule: schedule, geometry: geometry)
}
func freshStates() -> [SegmentID: SegmentState] {
    var m: [SegmentID: SegmentState] = [:]
    for (i, s) in segList.enumerated() { m[s.segment] = s.freshState(serial: i) }
    return m
}

print("== MUTANTS: each historical defect must trip its check ==")
mutant("A synthetic-hidden (r1/r2 det-fill)", "noSyntheticHidden") { t in
    BuggyRun.syntheticHidden(trace: t, segments: segList, states: freshStates(),
                             prompt: prompt, steps: 3, uids: UIDMinter())
}
mutant("B layer-only KV dictionary", "sameLayerStateFeedback") { t in
    BuggyRun.layerKeyedKV(trace: t, segments: segList, schedule: schedule,
                          prompt: prompt, steps: 3, uids: UIDMinter())
}
mutant("C cross-segment cache copy", "noCrossSegmentCache") { t in
    BuggyRun.crossSegmentCopy(trace: t, segments: segList, states: freshStates(),
                              prompt: prompt, steps: 3, uids: UIDMinter())
}
mutant("D zeroed state each step", "sameLayerStateFeedback") { t in
    BuggyRun.zeroedStateEachStep(trace: t, segments: segList, schedule: schedule,
                                 geometry: geometry, prompt: prompt, steps: 3, uids: UIDMinter())
}
mutant("E nondeterministic reset", "deterministicFreshInit") { t in
    BuggyRun.nondeterministicReset(trace: t, segments: segList, schedule: schedule,
                                   geometry: geometry, epochs: 2)
}
mutant("F position double-advance", "positionSingleAdvance") { t in
    BuggyRun.doubleAdvance(trace: t, embedWindow: embedW, prompt: prompt,
                           decodeSteps: 3, uids: UIDMinter())
}
mutant("G pair_probe final-prompt double-feed", "noFinalPromptDoubleFeed") { t in
    BuggyRun.promptDoubleFeed(trace: t, prompt: prompt, decodeSteps: 3, uids: UIDMinter())
}
mutant("H vacuous stateprobe claim", "claimsBacked") { t in
    BuggyRun.vacuousProbe(trace: t)
}
mutant("I wrong-token feedback", "generatedTokenFeedback") { t in
    BuggyRun.wrongTokenFeedback(trace: t, prompt: prompt, decodeSteps: 3, uids: UIDMinter())
}
mutant("J foreign map handoff (S2 gets S1 map)", "stateLayerSealing") { t in
    BuggyRun.foreignMapHandoff(trace: t, segments: segList, states: freshStates(),
                               prompt: prompt, steps: 3, uids: UIDMinter())
}
mutant("K padded S=16 decode (the D1 defect)", "noPaddedDispatch") { t in
    BuggyRun.paddedS16Decode(trace: t, prompt: prompt, decodeSteps: 3, uids: UIDMinter())
}
// The same mutant must also trip the S=1 decode-width law — 16 slots in a
// decode window is a width violation even before the pads are counted.
do {
    let t = ExecutionTrace()
    BuggyRun.paddedS16Decode(trace: t, prompt: prompt, decodeSteps: 3, uids: UIDMinter())
    let a = ContractAuditor.audit(trace: t, partition: partition, schedule: schedule)
    let c14 = a.checks.first { $0.id == "decodeSingleToken" }
    check(a.violations.contains { $0.check == "decodeSingleToken" } || (c14?.passed == false),
          "K padded S=16 decode: check 'decodeSingleToken' also fires")
}

print("== GUARD: partition validator rejects malformed partitions ==")
do {
    // overlapping partition must be rejected
    let s2 = partition.orderedSegments[1]
    var badLayers = partition.layersBySegment
    badLayers[s2] = (badLayers[s2] ?? []) + [LayerID(9)]
    let bad = PartitionMap(orderedSegments: partition.orderedSegments, layersBySegment: badLayers)
    check(!bad.validate(schedule: schedule).isEmpty, "overlapping layer detected by validator")
    _ = try CausalStepper(config: StepperConfig(
        schedule: schedule, geometry: geometry, partition: bad,
        embedding: MockEmbedding(window: embedW), segments: makeSegments(),
        head: MockHead(window: decodeW), prefillWindow: embedW,
        decodeContract: .strictSingleToken))
    check(false, "overlapping partition throws at stepper init")
} catch { check(true, "overlapping partition throws at stepper init") }
do {
    // gap partition (missing layer) must be rejected
    let s3 = partition.orderedSegments[2]
    var gapLayers = partition.layersBySegment
    gapLayers[s3] = Array((gapLayers[s3] ?? []).dropFirst())
    let gap = PartitionMap(orderedSegments: partition.orderedSegments, layersBySegment: gapLayers)
    check(!gap.validate(schedule: schedule).isEmpty, "missing layer detected by validator")
}

print("== GUARD: D1.1 width contract ==")
// Positive: the corrected control run must show the exact routing —
// 18-token prompt @ prefillWindow 16 -> widths [16, 1, 1], decode all S=1.
do {
    let st = try CausalStepper(config: cfg)
    st.reset()
    _ = try st.generate(prompt: prompt, maxNew: 3)
    var prefillWidths: [Int] = []
    var decodeWidths: [Int] = []
    var padTotal = 0
    for e in st.trace.events {
        if case .embed(_, let ph, let slots, _) = e {
            padTotal += slots.filter { $0.occupancy == .pad }.count
            if ph == .prefill { prefillWidths.append(slots.count) }
            if ph == .decode { decodeWidths.append(slots.count) }
        }
    }
    check(prefillWidths == [16, 1, 1],
          "prefill routing: full S=16 block then S=1 tail (got \(prefillWidths))")
    check(decodeWidths == [1, 1],
          "decode routing: every dispatch S=1 (got \(decodeWidths))")
    check(padTotal == 0, "corrected stepper mints zero pad slots")
}
// Negative: multiTokenAcceptance is an explicit contract — init accepts it
// (deliberate opt-in) but the greedy driver must refuse, not pad.
do {
    let mtCfg = StepperConfig(schedule: schedule, geometry: geometry, partition: partition,
                              embedding: MockEmbedding(window: embedW),
                              segments: makeSegments(),
                              head: MockHead(window: decodeW), prefillWindow: embedW,
                              decodeContract: .multiTokenAcceptance(width: 16))
    let st = try CausalStepper(config: mtCfg)
    st.reset()
    _ = try st.generate(prompt: prompt, maxNew: 2)
    check(false, "multiTokenAcceptance decode throws (no padded fallback)")
} catch StepperError.decodeContractNeedsSpeculativeDriver {
    check(true, "multiTokenAcceptance decode throws (no padded fallback)")
} catch { check(false, "multiTokenAcceptance decode throws (no padded fallback)") }
do {
    _ = try CausalStepper(config: StepperConfig(
        schedule: schedule, geometry: geometry, partition: partition,
        embedding: MockEmbedding(window: embedW), segments: makeSegments(),
        head: MockHead(window: decodeW), prefillWindow: 0,
        decodeContract: .strictSingleToken))
    check(false, "prefillWindow 0 rejected at init")
} catch { check(true, "prefillWindow 0 rejected at init") }

print("\n== RESULT: \(failures == 0 ? "ALL CHECKS PASSED" : "\(failures) FAILURE(S)") ==")
exit(failures == 0 ? 0 : 1)
