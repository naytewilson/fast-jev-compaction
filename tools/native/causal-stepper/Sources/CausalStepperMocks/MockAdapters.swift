// MockAdapters.swift — deterministic Linux-runnable adapters.
//
// These prove ORCHESTRATION semantics only. They are not Core ML and do not
// claim numerical correctness — they make the state law mechanically
// observable: every state read/write, hidden handoff, and token feed is
// deterministic so the auditor can compare identities exactly.

import CausalStepperCore

/// Deterministic embedding: hidden bytes derived from (token, position)
/// of each real slot plus a fixed pad salt. Same input -> same output.
public final class MockEmbedding: EmbeddingAdapter {
    public let window: Int
    public let hiddenSize: Int
    public init(window: Int, hiddenSize: Int = 2048) {
        self.window = window
        self.hiddenSize = hiddenSize
    }
    public func embed(tokens: [TokenID?], window: StepWindow) -> TensorData {
        var seed: UInt64 = 0xE1BEDD
        for (i, t) in tokens.enumerated() {
            if let v = t, case .real(let p, _) = window.slots[i].occupancy {
                seed = DetHash.mix([seed, UInt64(bitPattern: Int64(v)), UInt64(p)])
            } else {
                seed = DetHash.mix([seed, 0x9A0])
            }
        }
        return TensorData(shape: [1, window.slots.count, hiddenSize],
                          bytes: DetHash.bytes(seed, count: 32))
    }
}

/// Deterministic segment: hidden' = mix(hidden, segment ordinal, last real
/// position). State per layer: new = mix(prevHash, inputHash, position) —
/// so next-step reads provably equal last-step writes ONLY if the stepper
/// feeds the same map back to the same segment.
public final class MockSegment: SegmentAdapter {
    public let segment: SegmentID
    public let window: Int
    public let layers: [LayerID]
    public let schedule: LayerSchedule
    public let geometry: ModelGeometry

    public init(segment: SegmentID, layers: [LayerID], window: Int,
                schedule: LayerSchedule, geometry: ModelGeometry) {
        self.segment = segment
        self.layers = layers
        self.window = window
        self.schedule = schedule
        self.geometry = geometry
    }

    public func freshState(serial: Int) -> SegmentState {
        FreshState.zeroed(
            segment: segment, layers: layers,
            kindsFor: { LayerCacheLaw.kinds(for: $0, schedule: schedule) },
            shapeFor: { l, k in geometry.stateShape(layer: l, kind: k, schedule: schedule) },
            serial: serial)
    }

    public func evaluate(hidden: HiddenState, window: StepWindow, state: SegmentState) -> TensorData {
        var seed = hidden.data.contentHash ^ UInt64(segment.ordinal &* 0x9E37)
        for l in layers.sorted() {
            for kind in LayerCacheLaw.kinds(for: l, schedule: schedule) {
                let key = RecurrentStateKey(layer: l, kind: kind)
                let prev = state.read(key)
                let lastReal = window.realSlots.last?.position ?? -1
                let newHash = DetHash.mix([prev?.contentHash ?? 0,
                                           hidden.data.contentHash,
                                           UInt64(bitPattern: Int64(lastReal)),
                                           UInt64(l.index), UInt64(bitPattern: Int64(kind.hashValue))])
                _ = state.write(key, TensorData(shape: prev?.shape ?? [1], bytes: DetHash.bytes(newHash, count: 16)))
                seed = DetHash.mix([seed, newHash])
            }
        }
        return TensorData(shape: hidden.data.shape, bytes: DetHash.bytes(seed, count: 32))
    }
}

/// Deterministic head: next token = mix(hidden, slot) mod V.
public final class MockHead: HeadAdapter {
    public let window: Int
    public let vocabSize: Int
    public init(window: Int, vocabSize: Int = 128_000) {
        self.window = window
        self.vocabSize = vocabSize
    }
    public func nextToken(hidden: HiddenState, realSlotOffset: Int, window: StepWindow) -> TokenID {
        let h = DetHash.mix([hidden.data.contentHash, UInt64(realSlotOffset), 0xBEEF])
        return TokenID(truncatingIfNeeded: h % UInt64(vocabSize))
    }
}
