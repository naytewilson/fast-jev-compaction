// Adapters.swift — the narrow ports between the causal contract and engines.
//
// The stepper owns orchestration; adapters own per-segment compute. A
// production (macOS/CoreML) adapter implements these same protocols over
// .mlmodelc dispatch — the state law is identical, only the tensor backend
// changes. Mock adapters in CausalStepperMocks prove the contract on Linux.

/// One position inside a dispatch window.
public struct Slot: Equatable, CustomStringConvertible {
    public enum Occupancy: Equatable, CustomStringConvertible {
        /// A real token at a real sequence position.
        case real(position: Int, token: TokenRef)
        /// FALSIFIED under H17 KVIO (D1.1): a pad slot still writes K/V and
        /// advances conv state, so "pad" is not free — the corrected stepper
        /// never mints one. The case remains so adversarial/mutant traces can
        /// express the historical defect for the auditor to reject.
        case pad
        public var description: String {
            switch self {
            case .real(let p, let t): return "real(pos:\(p),\(t))"
            case .pad: return "pad"
            }
        }
    }
    public let occupancy: Occupancy
    public init(_ occupancy: Occupancy) { self.occupancy = occupancy }
    public var description: String { occupancy.description }
}

/// A dispatch window handed to each segment in order.
public struct StepWindow: CustomStringConvertible {
    public let phase: Phase
    public let slots: [Slot]
    /// Which window this is inside the run (monotonic).
    public let chainID: Int

    public init(phase: Phase, slots: [Slot], chainID: Int) {
        self.phase = phase
        self.slots = slots
        self.chainID = chainID
    }

    public var realSlots: [(offset: Int, position: Int, token: TokenRef)] {
        slots.enumerated().compactMap {
            if case .real(let p, let t) = $0.element.occupancy { return ($0.offset, p, t) }
            return nil
        }
    }
    public var lastRealSlotOffset: Int? { realSlots.last?.offset }
    public var description: String { "\(phase)#\(chainID)[\(slots.map { $0.description }.joined(separator: ","))]" }
}

/// Embedding adapter: token -> hidden. Embed is OUT of the body graph
/// (matches the KVIO packages' `hidden_states` input contract).
public protocol EmbeddingAdapter {
    /// Positions evaluated per dispatch.
    var window: Int { get }
    /// tokens[i] == nil means pad slot. Returns hidden [1, S, H].
    func embed(tokens: [TokenID?], window: StepWindow) -> TensorData
}

/// One body segment (S1/S2/S3): hidden in, hidden out, recurrent state
/// updated IN PLACE in the segment's own sealed map.
public protocol SegmentAdapter {
    var segment: SegmentID { get }
    /// Widest dispatch window this adapter can evaluate. The corrected
    /// D1.1 driver sends variable widths — S=16 full prefill blocks and
    /// S=1 tail/decode — so a production adapter holds one package handle
    /// per emitted width and selects on `window.slots.count`.
    var window: Int { get }
    /// Layers this adapter computes — must equal its partition layer set.
    var layers: [LayerID] { get }
    /// Deterministic fresh state, called exactly once per engine epoch.
    func freshState(serial: Int) -> SegmentState
    /// Evaluate one window. Reads/writes ONLY its own state map.
    func evaluate(hidden: HiddenState, window: StepWindow, state: SegmentState) -> TensorData
}

/// Head adapter: final hidden -> next token.
public protocol HeadAdapter {
    var window: Int { get }
    /// Produce the next token from the hidden of ONE real slot.
    func nextToken(hidden: HiddenState, realSlotOffset: Int, window: StepWindow) -> TokenID
}

/// Optional state-initializer override for adapters that construct
/// non-zero fresh state (e.g. learned init). Must remain deterministic.
public protocol DeterministicInit {
    /// Salt identifying the initializer's deterministic content.
    var initSalt: UInt64 { get }
}
