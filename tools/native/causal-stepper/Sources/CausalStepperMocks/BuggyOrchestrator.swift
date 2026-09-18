// BuggyOrchestrator.swift — faithful reconstructions of the historical
// Route-G chain defects. Each driver reproduces ONE defect class against
// the real trace/state machinery, so the regression bank can prove the
// auditor fires on exactly the defect that was reintroduced — and only then.
//
// Defects modeled (r2/r3 adjudication, ROUTE_G_3X10_PERF_RECEIPT):
//   A. synthetic hidden per segment (Float(i % 2048) det-fill; lastOut
//      assigned then discarded);
//   B. layer-only KV dictionary (K and V collide; second write wins);
//   C. cross-segment cache copying / foreign map handoff;
//   D. freshly-synthesized state each step (recurrence never fed back);
//   E. nondeterministic reset;
//   F. position double-advance;
//   G. pair_probe final-prompt double-feed;
//   H. vacuous stateprobe claim (no byte-equality evidence);
//   I. wrong-token feedback (generated token not fed to next step).

import CausalStepperCore

public enum BuggyRun {

    // -- shared plumbing ----------------------------------------------------

    private static func mintHidden(_ uids: UIDMinter, seed: UInt64, shape: [Int],
                                   origin: HiddenState.Origin) -> HiddenState {
        HiddenState(uid: uids.mintForeign(), data: TensorData(shape: shape, bytes: DetHash.bytes(seed, count: 32)), origin: origin)
    }

    private static func recordEval(_ trace: ExecutionTrace, chainID: Int,
                                   seg: SegmentAdapter, phase: Phase,
                                   hIn: HiddenState, hOut: HiddenState,
                                   st: SegmentState, j: StateJournal) {
        trace.record(.segmentEval(chainID: chainID, segment: seg.segment, phase: phase,
                                  inputUID: hIn.uid, inputOrigin: hIn.origin,
                                  outputUID: hOut.uid, stateSerial: st.serial,
                                  reads: j.reads, writes: j.writes,
                                  sealViolations: st.sealViolations))
    }

    private static func promptSlots(_ prompt: [TokenID], at positions: [Int]) -> [Slot] {
        zip(prompt, positions).map { Slot(.real(position: $1, token: TokenRef(value: $0, source: .prompt(index: $1)))) }
    }

    /// A. Synthetic hidden per segment — the r1/r2 `Float(i % 2048)` defect.
    /// Each segment gets a fabricated input; `lastOut` is computed then
    /// discarded, exactly as in the quarantined chain body.
    public static func syntheticHidden(trace: ExecutionTrace,
                                       segments: [SegmentAdapter],
                                       states: [SegmentID: SegmentState],
                                       prompt: [TokenID], steps: Int,
                                       uids: UIDMinter) {
        var cid = 0
        for step in 0..<steps {
            let phase: Phase = step == 0 ? .prefill : .decode
            let w = StepWindow(phase: phase,
                               slots: promptSlots(prompt, at: Array(0..<prompt.count)),
                               chainID: cid)
            let e = mintHidden(uids, seed: UInt64(1000 &+ step), shape: [1, prompt.count, 2048], origin: .embedded)
            trace.record(.embed(chainID: cid, phase: phase,
                                slots: w.slots.enumerated().map { ($0.offset, $0.element.occupancy) },
                                outputUID: e.uid))
            var lastOut = e
            for seg in segments {
                // DEFECT: synthetic det-fill hidden per segment — predecessor
                // output is computed into `lastOut` then IGNORED.
                let synth = mintHidden(uids, seed: UInt64(0x5EED + step * 7 + seg.segment.ordinal),
                                       shape: e.data.shape, origin: .external)
                let st = states[seg.segment]!
                st.beginJournal()
                let outData = seg.evaluate(hidden: synth, window: w, state: st)
                let j = st.endJournal()
                lastOut = HiddenState(uid: uids.mint(), data: outData, origin: .computed(seg.segment))
                _ = lastOut  // discarded — the historical `_ = lastOut`
                recordEval(trace, chainID: cid, seg: seg, phase: phase, hIn: synth, hOut: lastOut, st: st, j: j)
            }
            cid += 1
        }
    }

    /// B. Layer-only KV dictionary — the r2 `[Int: MLMultiArray]` collision.
    /// One slot per layer; V write overwrites K. Reads return whatever is in
    /// the slot — the auditor sees K reads carrying V's content.
    public static func layerKeyedKV(trace: ExecutionTrace,
                                    segments: [SegmentAdapter],
                                    schedule: LayerSchedule,
                                    prompt: [TokenID], steps: Int,
                                    uids: UIDMinter) {
        var cid = 0
        // The buggy map: layer -> single tensor slot (K and V share it).
        var buggyMaps: [SegmentID: [LayerID: TensorData]] = [:]
        for seg in segments {
            buggyMaps[seg.segment] = [:]
        }
        for step in 0..<steps {
            let phase: Phase = step == 0 ? .prefill : .decode
            var h = mintHidden(uids, seed: UInt64(step), shape: [1, 1, 2048], origin: .embedded)
            trace.record(.embed(chainID: cid, phase: phase,
                                slots: promptSlots(prompt, at: [step]).enumerated().map { ($0.offset, $0.element.occupancy) },
                                outputUID: h.uid))
            for seg in segments {
                var journal = StateJournal()
                var map = buggyMaps[seg.segment]!
                for l in seg.layers.sorted() {
                    let kinds = LayerCacheLaw.kinds(for: l, schedule: schedule)
                    for kind in kinds {
                        let key = RecurrentStateKey(layer: l, kind: kind)
                        // read: whatever the single slot holds
                        journal.reads.append((key, map[l]?.contentHash ?? 0))
                    }
                    for kind in kinds {
                        let key = RecurrentStateKey(layer: l, kind: kind)
                        let v = TensorData(shape: [1], bytes: DetHash.bytes(
                            DetHash.mix([UInt64(step), UInt64(l.index), UInt64(bitPattern: Int64(kind.hashValue))]), count: 16))
                        // DEFECT: both kinds write to the SAME layer slot —
                        // the second write (V) overwrites the first (K).
                        map[l] = v
                        journal.writes.append((key, v.contentHash))
                    }
                }
                buggyMaps[seg.segment] = map
                let st = SegmentState(segment: seg.segment, layers: Set(seg.layers), serial: 0)
                _ = st
                let hOut = mintHidden(uids, seed: h.data.contentHash ^ UInt64(seg.segment.ordinal), shape: h.data.shape, origin: .computed(seg.segment))
                trace.record(.segmentEval(chainID: cid, segment: seg.segment, phase: phase,
                                          inputUID: h.uid, inputOrigin: h.origin, outputUID: hOut.uid,
                                          stateSerial: seg.segment.ordinal,
                                          reads: journal.reads, writes: journal.writes,
                                          sealViolations: []))
                h = hOut
            }
            cid += 1
        }
    }

    /// C. Cross-segment cache copy — S1's state map handed to S2 (the r2
    /// "repair" that propagated nothing legal: cache IDs never overlap
    /// across the boundary, so copying hands foreign layers at best).
    public static func crossSegmentCopy(trace: ExecutionTrace,
                                        segments: [SegmentAdapter],
                                        states: [SegmentID: SegmentState],
                                        prompt: [TokenID], steps: Int,
                                        uids: UIDMinter) {
        var cid = 0
        for step in 0..<steps {
            let phase: Phase = step == 0 ? .prefill : .decode
            var h = mintHidden(uids, seed: UInt64(step), shape: [1, 1, 2048], origin: .embedded)
            trace.record(.embed(chainID: cid, phase: phase,
                                slots: promptSlots(prompt, at: [step]).enumerated().map { ($0.offset, $0.element.occupancy) },
                                outputUID: h.uid))
            // DEFECT: copy every key of the previous segment into the next
            // segment's map before it runs.
            var prevSeg: SegmentAdapter? = nil
            for seg in segments {
                if let p = prevSeg {
                    let src = states[p.segment]!
                    let dst = states[seg.segment]!
                    for (k, v) in src.entries {
                        _ = dst.write(k, v)   // foreign layer -> seal violation
                    }
                    trace.record(.stateCopied(from: p.segment, to: seg.segment,
                                              keys: src.keys))
                }
                let st = states[seg.segment]!
                st.beginJournal()
                let w = StepWindow(phase: phase, slots: promptSlots(prompt, at: [step]), chainID: cid)
                let outData = seg.evaluate(hidden: h, window: w, state: st)
                let j = st.endJournal()
                let hOut = HiddenState(uid: uids.mint(), data: outData, origin: .computed(seg.segment))
                recordEval(trace, chainID: cid, seg: seg, phase: phase, hIn: h, hOut: hOut, st: st, j: j)
                h = hOut
                prevSeg = seg
            }
            cid += 1
        }
    }

    /// D. Freshly-zeroed state every step — recurrent state is never fed
    /// back; each dispatch sees init content again.
    public static func zeroedStateEachStep(trace: ExecutionTrace,
                                           segments: [SegmentAdapter],
                                           schedule: LayerSchedule,
                                           geometry: ModelGeometry,
                                           prompt: [TokenID], steps: Int,
                                           uids: UIDMinter) {
        var cid = 0
        for step in 0..<steps {
            let phase: Phase = step == 0 ? .prefill : .decode
            var h = mintHidden(uids, seed: UInt64(step), shape: [1, 1, 2048], origin: .embedded)
            trace.record(.embed(chainID: cid, phase: phase,
                                slots: promptSlots(prompt, at: [step]).enumerated().map { ($0.offset, $0.element.occupancy) },
                                outputUID: h.uid))
            for seg in segments {
                // DEFECT: a NEW zeroed map per step — prior writes dropped.
                let st = seg.freshState(serial: seg.segment.ordinal)
                st.beginJournal()
                let w = StepWindow(phase: phase, slots: promptSlots(prompt, at: [step]), chainID: cid)
                let outData = seg.evaluate(hidden: h, window: w, state: st)
                let j = st.endJournal()
                let hOut = HiddenState(uid: uids.mint(), data: outData, origin: .computed(seg.segment))
                recordEval(trace, chainID: cid, seg: seg, phase: phase, hIn: h, hOut: hOut, st: st, j: j)
                h = hOut
            }
            cid += 1
        }
    }

    /// E. Nondeterministic reset — init content differs across epochs.
    public static func nondeterministicReset(trace: ExecutionTrace,
                                             segments: [SegmentAdapter],
                                             schedule: LayerSchedule,
                                             geometry: ModelGeometry,
                                             epochs: Int) {
        for e in 0..<epochs {
            for seg in segments {
                // DEFECT: epoch-salted init — identical request, different bytes.
                let st = SegmentState(segment: seg.segment, layers: Set(seg.layers), serial: seg.segment.ordinal)
                for l in seg.layers.sorted() {
                    for kind in LayerCacheLaw.kinds(for: l, schedule: schedule) {
                        let key = RecurrentStateKey(layer: l, kind: kind)
                        _ = st.write(key, TensorData(
                            shape: geometry.stateShape(layer: l, kind: kind, schedule: schedule),
                            bytes: DetHash.bytes(DetHash.mix([UInt64(e), UInt64(l.index), 0xEA7]), count: 16)))
                    }
                }
                trace.record(.stateInit(epoch: e + 1, segment: seg.segment, stateSerial: st.serial,
                                        initHashes: st.entries.map { ($0.key, $0.value.contentHash) }))
            }
        }
    }

    /// F. Position double-advance — decode positions jump +2 per token.
    public static func doubleAdvance(trace: ExecutionTrace,
                                     embedWindow: Int,
                                     prompt: [TokenID], decodeSteps: Int,
                                     uids: UIDMinter) {
        var cid = 0
        // one prefill window covering the whole prompt
        let preSlots = prompt.enumerated().map { Slot(.real(position: $0.offset, token: TokenRef(value: $0.element, source: .prompt(index: $0.offset)))) }
        var e = mintHidden(uids, seed: 1, shape: [1, prompt.count, 2048], origin: .embedded)
        trace.record(.embed(chainID: cid, phase: .prefill,
                            slots: preSlots.enumerated().map { ($0.offset, $0.element.occupancy) },
                            outputUID: e.uid))
        trace.record(.head(chainID: cid, phase: .prefill, inputUID: e.uid, realSlotOffset: prompt.count - 1,
                           produced: TokenRef(value: 42, source: .generated(step: 0))))
        cid += 1
        var pos = prompt.count
        for s in 0..<decodeSteps {
            // DEFECT: position advances by 2 — one sequence position is
            // silently skipped per generated token.
            pos += 2
            let slots = [Slot(.real(position: pos, token: TokenRef(value: 42, source: .generated(step: s))))]
            e = mintHidden(uids, seed: UInt64(pos), shape: [1, 1, 2048], origin: .embedded)
            trace.record(.embed(chainID: cid, phase: .decode,
                                slots: slots.enumerated().map { ($0.offset, $0.element.occupancy) },
                                outputUID: e.uid))
            trace.record(.head(chainID: cid, phase: .decode, inputUID: e.uid, realSlotOffset: 0,
                               produced: TokenRef(value: 43, source: .generated(step: s + 1))))
            cid += 1
        }
    }

    /// G. pair_probe final-prompt double-feed — first decode input is the
    /// LAST PROMPT TOKEN again instead of the generated token.
    public static func promptDoubleFeed(trace: ExecutionTrace,
                                        prompt: [TokenID], decodeSteps: Int,
                                        uids: UIDMinter) {
        var cid = 0
        let preSlots = prompt.enumerated().map { Slot(.real(position: $0.offset, token: TokenRef(value: $0.element, source: .prompt(index: $0.offset)))) }
        var e = mintHidden(uids, seed: 1, shape: [1, prompt.count, 2048], origin: .embedded)
        trace.record(.embed(chainID: cid, phase: .prefill,
                            slots: preSlots.enumerated().map { ($0.offset, $0.element.occupancy) },
                            outputUID: e.uid))
        let g0 = TokenRef(value: 555, source: .generated(step: 0))
        trace.record(.head(chainID: cid, phase: .prefill, inputUID: e.uid,
                           realSlotOffset: prompt.count - 1, produced: g0))
        cid += 1
        var pos = prompt.count
        for s in 0..<decodeSteps {
            // DEFECT: feed the last prompt token AGAIN (s==0) rather than g0.
            let fed: TokenRef = (s == 0)
                ? TokenRef(value: prompt.last!, source: .prompt(index: prompt.count - 1))
                : TokenRef(value: 555, source: .generated(step: s))
            let slots = [Slot(.real(position: pos, token: fed))]
            pos += 1
            e = mintHidden(uids, seed: UInt64(pos), shape: [1, 1, 2048], origin: .embedded)
            trace.record(.embed(chainID: cid, phase: .decode,
                                slots: slots.enumerated().map { ($0.offset, $0.element.occupancy) },
                                outputUID: e.uid))
            trace.record(.head(chainID: cid, phase: .decode, inputUID: e.uid, realSlotOffset: 0,
                               produced: TokenRef(value: 556, source: .generated(step: s + 1))))
            cid += 1
        }
    }

    /// H. Vacuous stateprobe — a claim with zero byte-equality evidence,
    /// matching the r2 probe whose "handed-bytes check" compared nothing.
    public static func vacuousProbe(trace: ExecutionTrace) {
        trace.record(.claim(id: "stateprobe", text: "S1-output KV bytes reach S2 inputs: PASS"))
        // DEFECT: no .stateEvidence events at all — the historical probe's
        // `guard let given, let prev else { continue }; _ = given; _ = prev`.
    }

    /// I. Wrong-token feedback — a token other than the produced one is fed
    /// to the next step (feedback wire crossed).
    public static func wrongTokenFeedback(trace: ExecutionTrace,
                                          prompt: [TokenID], decodeSteps: Int,
                                          uids: UIDMinter) {
        var cid = 0
        let preSlots = prompt.enumerated().map { Slot(.real(position: $0.offset, token: TokenRef(value: $0.element, source: .prompt(index: $0.offset)))) }
        var e = mintHidden(uids, seed: 1, shape: [1, prompt.count, 2048], origin: .embedded)
        trace.record(.embed(chainID: cid, phase: .prefill,
                            slots: preSlots.enumerated().map { ($0.offset, $0.element.occupancy) },
                            outputUID: e.uid))
        trace.record(.head(chainID: cid, phase: .prefill, inputUID: e.uid,
                           realSlotOffset: prompt.count - 1,
                           produced: TokenRef(value: 777, source: .generated(step: 0))))
        cid += 1
        var pos = prompt.count
        for s in 0..<decodeSteps {
            // DEFECT: feed a DIFFERENT generated-looking token than produced.
            let fed = TokenRef(value: 999, source: .generated(step: s))
            let slots = [Slot(.real(position: pos, token: fed))]
            pos += 1
            e = mintHidden(uids, seed: UInt64(pos), shape: [1, 1, 2048], origin: .embedded)
            trace.record(.embed(chainID: cid, phase: .decode,
                                slots: slots.enumerated().map { ($0.offset, $0.element.occupancy) },
                                outputUID: e.uid))
            trace.record(.head(chainID: cid, phase: .decode, inputUID: e.uid, realSlotOffset: 0,
                               produced: TokenRef(value: 888, source: .generated(step: s + 1))))
            cid += 1
        }
    }

    /// K. Padded S=16 decode — the exact D1 packet defect: each decode
    /// dispatch builds an S=16 window holding ONE real generated token plus
    /// fifteen trailing pad slots, then consumes only the real slot's logit.
    /// Under H17 KVIO the body still appends S=16 new K/V entries and drops
    /// the oldest 16: recurrent state advances sixteen positions per
    /// generated token while the driver believes it advanced one. The
    /// `noPaddedDispatch` / `decodeSingleToken` checks must both fire.
    public static func paddedS16Decode(trace: ExecutionTrace,
                                       prompt: [TokenID], decodeSteps: Int,
                                       uids: UIDMinter) {
        var cid = 0
        let preSlots = prompt.enumerated().map { Slot(.real(position: $0.offset, token: TokenRef(value: $0.element, source: .prompt(index: $0.offset)))) }
        var e = mintHidden(uids, seed: 1, shape: [1, prompt.count, 2048], origin: .embedded)
        trace.record(.embed(chainID: cid, phase: .prefill,
                            slots: preSlots.enumerated().map { ($0.offset, $0.element.occupancy) },
                            outputUID: e.uid))
        trace.record(.head(chainID: cid, phase: .prefill, inputUID: e.uid,
                           realSlotOffset: prompt.count - 1,
                           produced: TokenRef(value: 42, source: .generated(step: 0))))
        cid += 1
        var pos = prompt.count
        for s in 0..<decodeSteps {
            // DEFECT: S=16 decode window = 1 real + 15 pads. The emitted
            // packages write K/V for all 16 slots and drop the oldest 16 —
            // the driver's "advance by 1" bookkeeping is a lie.
            var slots = [Slot(.real(position: pos, token: TokenRef(value: 42, source: .generated(step: s))))]
            while slots.count < 16 { slots.append(Slot(.pad)) }
            pos += 1
            e = mintHidden(uids, seed: UInt64(pos), shape: [1, 16, 2048], origin: .embedded)
            trace.record(.embed(chainID: cid, phase: .decode,
                                slots: slots.enumerated().map { ($0.offset, $0.element.occupancy) },
                                outputUID: e.uid))
            trace.record(.head(chainID: cid, phase: .decode, inputUID: e.uid, realSlotOffset: 0,
                               produced: TokenRef(value: 43, source: .generated(step: s + 1))))
            cid += 1
        }
    }

    /// J. Foreign map handoff — S2 evaluated against S1's map object
    /// (same serial), i.e. caches cross the boundary wholesale.
    public static func foreignMapHandoff(trace: ExecutionTrace,
                                       segments: [SegmentAdapter],
                                       states: [SegmentID: SegmentState],
                                       prompt: [TokenID], steps: Int,
                                       uids: UIDMinter) {
        var cid = 0
        for step in 0..<steps {
            let phase: Phase = step == 0 ? .prefill : .decode
            var h = mintHidden(uids, seed: UInt64(step), shape: [1, 1, 2048], origin: .embedded)
            trace.record(.embed(chainID: cid, phase: phase,
                                slots: promptSlots(prompt, at: [step]).enumerated().map { ($0.offset, $0.element.occupancy) },
                                outputUID: h.uid))
            // DEFECT: every segment receives the FIRST segment's map.
            let first = states[segments.first!.segment]!
            for seg in segments {
                first.beginJournal()
                let w = StepWindow(phase: phase, slots: promptSlots(prompt, at: [step]), chainID: cid)
                let outData = seg.evaluate(hidden: h, window: w, state: first)
                let j = first.endJournal()
                let hOut = HiddenState(uid: uids.mint(), data: outData, origin: .computed(seg.segment))
                recordEval(trace, chainID: cid, seg: seg, phase: phase, hIn: h, hOut: hOut, st: first, j: j)
                h = hOut
            }
            cid += 1
        }
    }
}
