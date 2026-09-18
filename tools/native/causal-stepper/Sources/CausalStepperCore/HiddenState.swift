// HiddenState.swift — the ONLY tensor that crosses segment boundaries.
//
// Contract law: hidden state crosses S1 -> S2 -> S3. KV/conv caches do not.
// Every HiddenState carries a unique identity (`uid`) plus provenance, so an
// execution trace can mechanically prove that what entered S2 is byte-for-byte
// what left S1 — and that no synthetic tensor was fabricated in between.

/// Minimal platform-neutral tensor payload. Identity for audit purposes is
/// content-based: deterministic adapters produce deterministic bytes.
public struct TensorData: Equatable, Codable, CustomStringConvertible {
    public var shape: [Int]
    public var bytes: [UInt8]

    public init(shape: [Int], bytes: [UInt8]) {
        self.shape = shape
        self.bytes = bytes
    }

    /// FNV-1a content hash — cheap, deterministic, platform-neutral.
    /// Used by the auditor to compare state tensors across dispatches.
    public var contentHash: UInt64 {
        var h: UInt64 = 14695981039346656037
        for b in bytes {
            h ^= UInt64(b)
            h &*= 1099511628211
        }
        for s in shape {
            h ^= UInt64(bitPattern: Int64(s))
            h &*= 1099511628211
        }
        return h
    }

    public var description: String { "Tensor(shape:\(shape), hash:\(String(contentHash, radix: 16)))" }
}

/// Deterministic mixer used by mocks: derive a byte string from seeds.
/// NOT cryptography — a reproducibility device for tests.
public enum DetHash {
    public static func bytes(_ seed: UInt64, count: Int) -> [UInt8] {
        var x = seed &+ 0x9E3779B97F4A7C15
        var out = [UInt8](); out.reserveCapacity(count)
        while out.count < count {
            x ^= x >> 30; x &*= 0xBF58476D1CE4E5B9
            x ^= x >> 27; x &*= 0x94D049BB133111EB
            x ^= x >> 31
            out.append(UInt8(truncatingIfNeeded: x))
        }
        return out
    }
    public static func mix(_ parts: [UInt64]) -> UInt64 {
        var h: UInt64 = 14695981039346656037
        for p in parts {
            h ^= p
            h &*= 1099511628211
        }
        return h
    }
}

/// Unique identity for a hidden tensor within one engine run.
public final class UIDMinter {
    private var next: Int = 0
    public init() {}
    public func mint() -> Int {
        defer { next += 1 }
        return next
    }
    /// Exposed for sabotage adapters that must mint "foreign" UIDs.
    public func mintForeign() -> Int { mint() }
}

/// The hidden-state tensor handed embed -> S1 -> S2 -> S3 -> head.
public final class HiddenState {
    /// Unique per-run identity. The auditor compares uids, not payloads,
    /// to prove exact chaining.
    public let uid: Int
    public var data: TensorData
    /// Where this tensor came from. `.external` marks any tensor not
    /// produced inside the stepper's own chain — foreign tensors are legal
    /// as embedding output only at chain head; anywhere else they flag
    /// `syntheticHidden`.
    public let origin: Origin

    public enum Origin: Equatable, CustomStringConvertible {
        case embedded
        case computed(SegmentID)
        case external
        public var description: String {
            switch self {
            case .embedded: return "embedded"
            case .computed(let s): return "computed(\(s.name))"
            case .external: return "external"
            }
        }
    }

    public init(uid: Int, data: TensorData, origin: Origin) {
        self.uid = uid
        self.data = data
        self.origin = origin
    }
}
