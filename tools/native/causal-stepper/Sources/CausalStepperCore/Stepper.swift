// Stepper.swift — the causal state machine.
//
// Contract encoded:
//   token -> embed -> S1(hidden, S1 state) -> S2(hidden, S2 state)
//        -> S3(hidden, S3 state) -> head -> next token -> feedback.
//
//   * hidden crosses S1 -> S2 -> S3: the SAME HiddenState object that left
//     one segment is handed to the next. There is no code path that can
//     fabricate an intermediate tensor.
//   * caches never cross: `states[seg]` is the only map a segment sees.
//   * fresh state is built exactly once per epoch via `reset()`.
//   * prefill and decode are distinct phases with separate windows.
//   * generated token N is the input to step N+1 — never a prompt token.
//   * position advances exactly once per real token.

/// Decode dispatch law (D1.1 corrective). Under H17 KVIO every slot in a
/// window writes recurrent K/V and advances conv state — a pad slot is NOT
/// free: an S=16 call advances state by sixteen real positions whether or
/// not its logits are consumed. "1 real + 15 pads, ignore pad logits" is
/// therefore falsified and unrepresentable here.
public enum DecodeContract: Equatable {
    /// S=1: exactly one generated token enters per dispatch, exactly one
    /// causal position advances. The only legal greedy-decode contract.
    case strictSingleToken
    /// Explicit multi-token window (e.g. speculative decode). The driver
    /// must present `width` REAL candidate tokens per dispatch and an
    /// acceptance protocol decides how many commit. There is still no pad
    /// mode — every slot carries a real candidate. The plain greedy
    /// `generate()` cannot satisfy this contract and throws.
    case multiTokenAcceptance(width: Int)
}

public struct StepperConfig {
    public var schedule: LayerSchedule
    public var geometry: ModelGeometry
    public var partition: PartitionMap
    public var embedding: EmbeddingAdapter
    public var head: HeadAdapter
    /// segment -> adapter, keyed by the SAME SegmentID the partition uses.
    public var segments: [SegmentID: SegmentAdapter]
    /// Prefill block width. A window of this size is dispatched ONLY when
    /// every slot is a real prompt position; the prompt tail is stepped
    /// one real position per dispatch (S=1). Pads are never created.
    public var prefillWindow: Int
    /// Decode law. `.strictSingleToken` is the production contract.
    /// `.multiTokenAcceptance(w)` is accepted at init so a future
    /// speculative driver can opt in explicitly; `generate()` rejects it.
    public var decodeContract: DecodeContract

    public init(schedule: LayerSchedule, geometry: ModelGeometry, partition: PartitionMap,
                embedding: EmbeddingAdapter, segments: [SegmentID: SegmentAdapter],
                head: HeadAdapter, prefillWindow: Int,
                decodeContract: DecodeContract = .strictSingleToken) {
        self.schedule = schedule
        self.geometry = geometry
        self.partition = partition
        self.embedding = embedding
        self.segments = segments
        self.head = head
        self.prefillWindow = prefillWindow
        self.decodeContract = decodeContract
    }
}

public struct GenerationResult {
    public var prompt: [TokenID]
    public var generated: [TokenRef]
    public init(prompt: [TokenID], generated: [TokenRef]) {
        self.prompt = prompt
        self.generated = generated
    }
}

public enum StepperError: Error, CustomStringConvertible {
    case partitionViolations([String])
    case missingSegmentAdapter(SegmentID)
    case adapterLayerMismatch(SegmentID)
    case stateNotInitialized
    case emptyPrompt
    case invalidPrefillWindow(Int)
    /// multiTokenAcceptance needs a candidate-supplying driver that does not
    /// exist in this wave; there is deliberately no padded fallback.
    case decodeContractNeedsSpeculativeDriver
    public var description: String {
        switch self {
        case .partitionViolations(let v): return "partition violations: \(v)"
        case .missingSegmentAdapter(let s): return "no adapter for segment \(s)"
        case .adapterLayerMismatch(let s): return "adapter layers != partition layers for \(s)"
        case .stateNotInitialized: return "reset() must run before generate()"
        case .emptyPrompt: return "prompt must be non-empty"
        case .invalidPrefillWindow(let w): return "prefillWindow must be >= 1, got \(w)"
        case .decodeContractNeedsSpeculativeDriver:
            return "multiTokenAcceptance decode requires a speculative driver; pads are forbidden"
        }
    }
}

public final class CausalStepper {
    public let config: StepperConfig
    public let trace = ExecutionTrace()
    private let uids = UIDMinter()

    private var states: [SegmentID: SegmentState] = [:]
    private var stateSerials: [SegmentID: Int] = [:]
    private var nextSerial = 0
    public private(set) var epoch = 0
    /// Next REAL position to be consumed (prompt first, then decode).
    private var nextPosition = 0
    private var chainCounter = 0
    private var generatedCount = 0

    public init(config: StepperConfig) throws {
        self.config = config
        let violations = config.partition.validate(schedule: config.schedule)
        guard violations.isEmpty else { throw StepperError.partitionViolations(violations) }
        for seg in config.partition.orderedSegments {
            guard let ad = config.segments[seg] else {
                throw StepperError.missingSegmentAdapter(seg)
            }
            guard Set(ad.layers) == Set(config.partition.layersBySegment[seg] ?? []) else {
                throw StepperError.adapterLayerMismatch(seg)
            }
        }
        guard config.prefillWindow >= 1 else {
            throw StepperError.invalidPrefillWindow(config.prefillWindow)
        }
    }

    /// Fresh-state epoch boundary. Deterministic: each adapter builds its
    /// initial state exactly once per reset. Never mid-run.
    public func reset() {
        epoch += 1
        states.removeAll()
        stateSerials.removeAll()
        nextPosition = 0
        generatedCount = 0
        for seg in config.partition.orderedSegments {
            let serial = nextSerial; nextSerial += 1
            let st = config.segments[seg]!.freshState(serial: serial)
            states[seg] = st
            stateSerials[seg] = serial
            trace.record(.stateInit(epoch: epoch, segment: seg, stateSerial: serial,
                                    initHashes: st.entries.map { ($0.key, $0.value.contentHash) }))
        }
    }

    /// Run prefill over the prompt then `maxNew` decode steps.
    /// Returns produced tokens (each `.generated(step:)`).
    @discardableResult
    /// Teacher forcing: `forced` supplies the token fed at each decode step
    /// instead of the model's own argmax, isolating forward-computation
    /// numerics from greedy coin-flips. Where argmax diverges from `forced`,
    /// `generatedTokenFeedback` audit violations document the divergence.
    public func generate(prompt: [TokenID], maxNew: Int, forced: [TokenID]? = nil) throws -> GenerationResult {
        guard !states.isEmpty else { throw StepperError.stateNotInitialized }
        guard !prompt.isEmpty else { throw StepperError.emptyPrompt }
        var produced: [TokenRef] = []

        // ---- PREFILL: each prompt token exactly once, positions 0..P-1.
        // D1.1 law: a prefillWindow-sized dispatch runs ONLY when every slot
        // is a real prompt position. The tail is stepped one real position
        // per dispatch (S=1). Pads are never created — under KVIO a pad slot
        // would still write recurrent state.
        var pos = 0
        while pos < prompt.count {
            let width = min(config.prefillWindow, prompt.count - pos) == config.prefillWindow
                ? config.prefillWindow : 1
            let end = pos + width
            let slots: [Slot] = (pos..<end).map { i in
                Slot(.real(position: i, token: TokenRef(value: prompt[i], source: .prompt(index: i))))
            }
            let containsLastPrompt = (end == prompt.count)
            let out = dispatch(phase: .prefill, slots: slots)
            if containsLastPrompt, let realOffset = out.window.lastRealSlotOffset {
                let value = config.head.nextToken(hidden: out.hidden, realSlotOffset: realOffset, window: out.window)
                let t = TokenRef(value: value, source: .generated(step: generatedCount))
                generatedCount += 1
                produced.append(t)
                trace.record(.head(chainID: out.window.chainID, phase: .prefill,
                                   inputUID: out.hidden.uid, realSlotOffset: realOffset, produced: t))
            }
            pos = end
        }
        nextPosition = prompt.count

        // ---- DECODE: generated token N is the input to step N+1.
        // D1.1 law: strict S=1 — one real token, one position, zero pads.
        if case .multiTokenAcceptance = config.decodeContract {
            throw StepperError.decodeContractNeedsSpeculativeDriver
        }
        while produced.count < maxNew {
            // Teacher forcing: feed the HF-expected token at this step rather
            // than the model's own argmax, so a fragile pos-0 flip cannot poison
            // every later context. produced[k] is still the CoreML argmax —
            // only the next dispatch's input is overridden.
            let feeding: TokenRef
            if let f = forced, produced.count - 1 < f.count {
                let idx = produced.count - 1
                feeding = TokenRef(value: f[idx], source: .generated(step: idx))
            } else {
                feeding = produced.last!
            }
            let slots = [Slot(.real(position: nextPosition, token: feeding))]
            let out = dispatch(phase: .decode, slots: slots)
            let value = config.head.nextToken(hidden: out.hidden, realSlotOffset: 0, window: out.window)
            let t = TokenRef(value: value, source: .generated(step: generatedCount))
            generatedCount += 1
            produced.append(t)
            trace.record(.head(chainID: out.window.chainID, phase: .decode,
                               inputUID: out.hidden.uid, realSlotOffset: 0, produced: t))
            nextPosition += 1   // exactly once per generated token
        }

        return GenerationResult(prompt: prompt, generated: produced)
    }

    /// One dispatch: embed -> S1 -> S2 -> S3. Returns final hidden + window.
    private func dispatch(phase: Phase, slots: [Slot]) -> (hidden: HiddenState, window: StepWindow) {
        let chainID = chainCounter; chainCounter += 1
        let window = StepWindow(phase: phase, slots: slots, chainID: chainID)

        // embed
        let tokens = slots.map { s -> TokenID? in
            if case .real(_, let t) = s.occupancy { return t.value }
            return nil
        }
        let h0 = HiddenState(uid: uids.mint(),
                             data: config.embedding.embed(tokens: tokens, window: window),
                             origin: .embedded)
        trace.record(.embed(chainID: chainID, phase: phase,
                            slots: slots.enumerated().map { ($0.offset, $0.element.occupancy) },
                            outputUID: h0.uid))

        // segments in strict order — hidden is the ONLY thing that moves.
        var h = h0
        for seg in config.partition.orderedSegments {
            let st = states[seg]!
            let adapter = config.segments[seg]!
            st.beginJournal()
            let outData = adapter.evaluate(hidden: h, window: window, state: st)
            let j = st.endJournal()
            let hOut = HiddenState(uid: uids.mint(), data: outData, origin: .computed(seg))
            trace.record(.segmentEval(chainID: chainID, segment: seg, phase: phase,
                                      inputUID: h.uid, inputOrigin: h.origin,
                                      outputUID: hOut.uid,
                                      stateSerial: st.serial,
                                      reads: j.reads, writes: j.writes,
                                      sealViolations: st.sealViolations))
            h = hOut
        }
        return (h, window)
    }
}
