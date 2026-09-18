// Partition.swift — layer schedule and segment partition law.
//
// Proven architecture facts bound here (CAMPAIGN_2P6B_PRODUCTION_20260916 +
// ane-re LFM2Config.lfm25_2p6b, feat/h17-26of32-publication-fix-20260825):
//   30 layers, 22 conv + 8 GQA at {2,5,9,13,17,21,24,27},
//   H=2048, IM=10752, NH=32, NKV=8, HD=64, conv L=3, ropeTheta=1e7,
//   V=128000, initial 3x10 partition S1=0..9 / S2=10..19 / S3=20..29.

/// The model's exact layer order.
public struct LayerSchedule: Equatable, Codable {
    /// kinds[i] = kind of layer i. Length = layer count.
    public let kinds: [LayerKind]

    public init(kinds: [LayerKind]) { self.kinds = kinds }

    public var layerCount: Int { kinds.count }
    public var attentionLayers: [LayerID] {
        kinds.enumerated().compactMap { $0.element == .fullAttention ? LayerID($0.offset) : nil }
    }
    public var convLayers: [LayerID] {
        kinds.enumerated().compactMap { $0.element == .conv ? LayerID($0.offset) : nil }
    }
    public func kind(of layer: LayerID) -> LayerKind { kinds[layer.index] }

    /// The proven LFM2.5-2.6B schedule: full_attention at
    /// {2,5,9,13,17,21,24,27}, conv everywhere else.
    public static let lfm25_2p6b = LayerSchedule(kinds: [
        .conv, .conv, .fullAttention,   // 0,1,2
        .conv, .conv, .fullAttention,   // 3,4,5
        .conv, .conv, .conv, .fullAttention, // 6,7,8,9
        .conv, .conv, .conv, .fullAttention, // 10,11,12,13
        .conv, .conv, .conv, .fullAttention, // 14,15,16,17
        .conv, .conv, .conv, .fullAttention, // 18,19,20,21
        .conv, .conv, .fullAttention,   // 22,23,24
        .conv, .conv, .fullAttention,   // 25,26,27
        .conv, .conv                    // 28,29
    ])
}

/// Cache kinds a layer owns under the KVIO contract.
public enum LayerCacheLaw {
    /// full_attention -> K and V (distinct identities); conv -> conv cache.
    public static func kinds(for layer: LayerID, schedule: LayerSchedule) -> [CacheKind] {
        switch schedule.kind(of: layer) {
        case .fullAttention: return [.key, .value]
        case .conv: return [.conv]
        }
    }
}

/// Model geometry needed to shape fresh state (proven 2.6B constants).
public struct ModelGeometry: Equatable, Codable {
    public var hiddenSize: Int        // H
    public var numKVHeads: Int        // NKV
    public var headDim: Int           // HD
    public var kvCtx: Int             // CTX sliding window
    public var convLCache: Int        // L
    public var vocabSize: Int         // V
    public var intermediateSize: Int  // IM

    public static let lfm25_2p6b = ModelGeometry(
        hiddenSize: 2048, numKVHeads: 8, headDim: 64,
        kvCtx: 512, convLCache: 3, vocabSize: 128_000, intermediateSize: 10_752)

    /// Host-visible shape of one recurrent cache tensor.
    /// KVIO contract: K/V are [1, NKV, CTX, HD] fp16;
    /// conv cache host I/O is last-wide rank-3 [1, L-1, H] (H17 publication
    /// law — internal compute stays [1, H, L-1, 1]).
    public func stateShape(layer: LayerID, kind: CacheKind, schedule: LayerSchedule) -> [Int] {
        switch kind {
        case .key, .value: return [1, numKVHeads, kvCtx, headDim]
        case .conv: return [1, convLCache - 1, hiddenSize]
        }
    }
}

/// The ordered segment partition over the layer schedule.
/// Law: contiguous, gap-free, overlap-free coverage of all layers; each
/// segment owns exactly its own layer set forever.
public struct PartitionMap: Equatable, Codable {
    public let orderedSegments: [SegmentID]
    public let layersBySegment: [SegmentID: [LayerID]]

    public init(orderedSegments: [SegmentID], layersBySegment: [SegmentID: [LayerID]]) {
        self.orderedSegments = orderedSegments
        self.layersBySegment = layersBySegment
    }

    /// The proven initial production partition: S1 0..9, S2 10..19, S3 20..29.
    public static let lfm25_2p6b_3x10 = PartitionMap(
        orderedSegments: [
            SegmentID(ordinal: 0, name: "s1"),
            SegmentID(ordinal: 1, name: "s2"),
            SegmentID(ordinal: 2, name: "s3"),
        ],
        layersBySegment: [
            SegmentID(ordinal: 0, name: "s1"): (0..<10).map(LayerID.init),
            SegmentID(ordinal: 1, name: "s2"): (10..<20).map(LayerID.init),
            SegmentID(ordinal: 2, name: "s3"): (20..<30).map(LayerID.init),
        ])

    /// Structural validation — returns violations (empty = lawful).
    public func validate(schedule: LayerSchedule) -> [String] {
        var violations: [String] = []
        // segments strictly ordered
        for (a, b) in zip(orderedSegments, orderedSegments.dropFirst()) where !(a < b) {
            violations.append("segment order violated: \(a) then \(b)")
        }
        // exact coverage: every layer exactly once, no gaps, no foreign layers
        var seen = Set<LayerID>()
        for seg in orderedSegments {
            guard let ls = layersBySegment[seg], !ls.isEmpty else {
                violations.append("segment \(seg) has no layer set")
                continue
            }
            for l in ls {
                if l.index < 0 || l.index >= schedule.layerCount {
                    violations.append("segment \(seg) claims out-of-range layer \(l)")
                }
                if !seen.insert(l).inserted {
                    violations.append("layer \(l) claimed by two segments")
                }
            }
        }
        for i in 0..<schedule.layerCount where !seen.contains(LayerID(i)) {
            violations.append("layer L\(i) unclaimed by any segment")
        }
        // contiguity within each segment
        for seg in orderedSegments {
            if let ls = layersBySegment[seg]?.sorted(),
               zip(ls, ls.dropFirst()).contains(where: { $0.1.index != $0.0.index + 1 }) {
                violations.append("segment \(seg) layer set is not contiguous")
            }
        }
        // segments partition in ascending order (no interleaving)
        var cursor = 0
        for seg in orderedSegments {
            if let ls = layersBySegment[seg]?.sorted(), let first = ls.first {
                if first.index != cursor {
                    violations.append("segment \(seg) does not start at expected layer \(cursor)")
                }
                cursor = (ls.last?.index ?? cursor - 1) + 1
            }
        }
        return violations
    }

    /// Per-segment expected cache keys under the KVIO contract.
    public func expectedKeys(segment: SegmentID, schedule: LayerSchedule) -> Set<RecurrentStateKey> {
        var out = Set<RecurrentStateKey>()
        for l in layersBySegment[segment] ?? [] {
            for k in LayerCacheLaw.kinds(for: l, schedule: schedule) {
                out.insert(RecurrentStateKey(layer: l, kind: k))
            }
        }
        return out
    }
}
