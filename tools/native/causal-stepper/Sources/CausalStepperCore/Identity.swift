// Identity.swift — mechanical identity types for the causal contract.
//
// The historical Route-G r2 chain bugs were all identity defects:
//   - state keyed by layer alone (K and V collided in one slot);
//   - synthetic hidden fabricated between segments;
//   - layer-local caches copied across the S1->S2->S3 boundary;
//   - vacuous "probe" claims with no byte-equality evidence.
// These types make the correct identities the only representable ones.

/// Vocabulary token identity.
public typealias TokenID = Int32

/// One architectural layer of the model (0..<30 for LFM2.5-2.6B).
public struct LayerID: Hashable, Comparable, CustomStringConvertible, Codable {
    public let index: Int
    public init(_ index: Int) { self.index = index }
    public static func < (l: LayerID, r: LayerID) -> Bool { l.index < r.index }
    public var description: String { "L\(index)" }
}

/// Architectural layer kind, matching HF `layer_types`.
public enum LayerKind: String, Codable, Comparable {
    case conv
    case fullAttention = "full_attention"
    public static func < (l: LayerKind, r: LayerKind) -> Bool { l.rawValue < r.rawValue }
}

/// One body segment in the causal chain (S1 -> S2 -> S3).
/// `ordinal` is the execution order; segments run strictly ascending.
public struct SegmentID: Hashable, Comparable, CustomStringConvertible, Codable {
    public let ordinal: Int
    public let name: String
    public init(ordinal: Int, name: String) {
        self.ordinal = ordinal
        self.name = name
    }
    public static func < (l: SegmentID, r: SegmentID) -> Bool { l.ordinal < r.ordinal }
    public var description: String { name }
}

/// Recurrent-cache identity within one layer.
///
/// K and V are mechanically distinct: a dictionary keyed by `LayerID` alone
/// CANNOT hold both — that was the r2 collision (second write overwrote the
/// first). `CacheKind` makes the two slots structurally separate.
public enum CacheKind: String, Hashable, Comparable, Codable, CaseIterable {
    case key
    case value
    case conv
    public static func < (l: CacheKind, r: CacheKind) -> Bool { l.rawValue < r.rawValue }
}

/// The full identity of one recurrent cache tensor: one architectural layer
/// plus one cache kind. There is no layer-only address in this system.
public struct RecurrentStateKey: Hashable, Comparable, CustomStringConvertible, Codable {
    public let layer: LayerID
    public let kind: CacheKind
    public init(layer: LayerID, kind: CacheKind) {
        self.layer = layer
        self.kind = kind
    }
    public static func < (l: RecurrentStateKey, r: RecurrentStateKey) -> Bool {
        (l.layer, l.kind) < (r.layer, r.kind)
    }
    public var description: String { "\(layer).\(kind.rawValue)" }
}

/// Which phase a dispatch belongs to. Prefill and decode are distinct
/// state-machine phases, never blended inside one window.
public enum Phase: String, Codable, Comparable {
    case prefill
    case decode
    public static func < (l: Phase, r: Phase) -> Bool { l.rawValue < r.rawValue }
}

/// Provenance of a token fed into the pipeline. The pair_probe defect
/// re-fed the last PROMPT token as the first decode input; that is only
/// possible when sources are tracked — a decode-phase real slot carrying
/// `.prompt` is mechanically flagged.
public enum TokenSource: Equatable, Codable, CustomStringConvertible {
    case prompt(index: Int)
    case generated(step: Int)
    public var description: String {
        switch self {
        case .prompt(let i): return "prompt[\(i)]"
        case .generated(let s): return "gen[\(s)]"
        }
    }
}

/// A token with provenance.
public struct TokenRef: Equatable, Codable, CustomStringConvertible {
    public let value: TokenID
    public let source: TokenSource
    public init(value: TokenID, source: TokenSource) {
        self.value = value
        self.source = source
    }
    public var description: String { "\(value)@\(source)" }
}
