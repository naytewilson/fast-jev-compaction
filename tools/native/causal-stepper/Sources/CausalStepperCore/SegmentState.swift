// SegmentState.swift — layer-sealed recurrent state for ONE segment.
//
// Law encoded here:
//   * every recurrent cache belongs to one architectural layer;
//   * a segment's state map only accepts keys for ITS OWN layers —
//     an S1 layer key physically cannot enter an S2 map;
//   * the map persists across token steps for the same layer only;
//   * there is no API that moves state between two SegmentState objects.

/// A read/write journal captured around one segment evaluation so the
/// auditor can verify same-layer feedback byte-for-byte.
public struct StateJournal {
    public var reads: [(key: RecurrentStateKey, hash: UInt64)] = []
    public var writes: [(key: RecurrentStateKey, hash: UInt64)] = []
    public init() {}
}

public final class SegmentState {
    /// Which segment owns this map. Fixed at construction.
    public let segment: SegmentID
    /// The architectural layers this segment may hold state for.
    /// Sealing rule: any key outside this set is refused and recorded.
    public let layers: Set<LayerID>

    private var map: [RecurrentStateKey: TensorData] = [:]

    /// Seal violations observed on this map (out-of-domain write attempts).
    /// A correct run leaves this empty forever.
    public private(set) var sealViolations: [String] = []

    /// Serial identity of this map object within the run — lets the auditor
    /// prove each segment was handed ITS OWN map (and only ever that one).
    public let serial: Int

    private var journal: StateJournal?
    /// When true, `read`/`write` calls are recorded into `journal`.
    public var journalingEnabled: Bool = false

    public init(segment: SegmentID, layers: Set<LayerID>, serial: Int) {
        self.segment = segment
        self.layers = layers
        self.serial = serial
    }

    public func contains(_ key: RecurrentStateKey) -> Bool { map[key] != nil }

    /// Read the tensor for a key. Returns nil for absent keys.
    /// Out-of-domain reads are recorded as seal violations — a segment has
    /// no business even ASKING for another layer's cache.
    @discardableResult
    public func read(_ key: RecurrentStateKey) -> TensorData? {
        if !layers.contains(key.layer) {
            sealViolations.append("read of foreign layer \(key.layer) by \(segment.name)")
        }
        let v = map[key]
        if journalingEnabled {
            journal?.reads.append((key, v?.contentHash ?? 0))
        }
        return v
    }

    /// Write a tensor for a key. Out-of-domain layers are refused (value NOT
    /// stored) and the violation is recorded. Returns true iff stored.
    @discardableResult
    public func write(_ key: RecurrentStateKey, _ value: TensorData) -> Bool {
        guard layers.contains(key.layer) else {
            sealViolations.append("write of foreign layer \(key.layer) by \(segment.name)")
            return false
        }
        map[key] = value
        if journalingEnabled {
            journal?.writes.append((key, value.contentHash))
        }
        return true
    }

    public var keys: [RecurrentStateKey] { map.keys.sorted() }
    public var keySetHash: UInt64 {
        DetHash.mix(keys.sorted().map { DetHash.mix([UInt64($0.layer.index), UInt64(bitPattern: Int64($0.kind.hashValue))]) })
    }

    /// All (key -> tensor) entries, for auditing. There is intentionally
    /// NO bulk-import API: state enters this map only through `write`.
    public var entries: [(key: RecurrentStateKey, value: TensorData)] {
        keys.map { ($0, map[$0]!) }
    }

    // MARK: journaling (used by CausalStepper around each evaluate call)

    public func beginJournal() {
        journal = StateJournal()
        journalingEnabled = true
    }
    public func endJournal() -> StateJournal {
        journalingEnabled = false
        let j = journal ?? StateJournal()
        journal = nil
        return j
    }
}

/// Deterministic fresh-state construction — the ONLY way a SegmentState
/// may be populated at engine reset. Called exactly once per segment per
/// epoch by the stepper. Anything else (per-step re-zeroing, cross-segment
/// copies) is a contract violation the auditor will see.
public enum FreshState {
    /// Build the zeroed initial state for one segment given the schedule.
    /// Deterministic: identical inputs -> identical bytes, always.
    public static func zeroed(segment: SegmentID,
                              layers: [LayerID],
                              kindsFor: (LayerID) -> [CacheKind],
                              shapeFor: (LayerID, CacheKind) -> [Int],
                              serial: Int) -> SegmentState {
        let st = SegmentState(segment: segment, layers: Set(layers), serial: serial)
        for layer in layers.sorted() {
            for kind in kindsFor(layer).sorted() {
                let shape = shapeFor(layer, kind)
                let count = shape.reduce(1, *)
                let bytes = DetHash.bytes(
                    DetHash.mix([0xF0E5_7A7E, UInt64(layer.index), UInt64(bitPattern: Int64(kind.hashValue))]),
                    count: min(count, 64))
                _ = st.write(RecurrentStateKey(layer: layer, kind: kind),
                             TensorData(shape: shape, bytes: bytes))
            }
        }
        return st
    }
}
