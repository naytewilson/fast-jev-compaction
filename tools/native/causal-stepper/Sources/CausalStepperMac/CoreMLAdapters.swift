// CoreMLAdapters.swift — production macOS/CoreML adapters for the D1.1
// causal contract. Same protocols as the mocks; the tensor backend is
// MLModel dispatch over the emitted .mlmodelc packages.
//
// D1.1 state law implemented here:
//   * each segment owns ONLY its own recurrent state (KV + conv);
//   * fresh state = zeros, built once per epoch;
//   * hidden is the ONLY tensor crossing segment boundaries;
//   * S=1 decode / S=16 all-real prefill blocks / S=1 prompt tail;
//   * cache_mask_in marks the LAST `validCount` of 512 slots valid
//     (drop-oldest right-aligned window; -inf elsewhere);
//   * cos/sin supplied per absolute position (ropeTheta = 1e7, HD=64,
//     duplicated halves [c0..c31, c0..c31]).
#if canImport(CoreML)

import CoreML
import Foundation
import Darwin
import CryptoKit
import CausalStepperCore

public enum MacAdapterError: Error, CustomStringConvertible {
    case loadFailed(String, String)
    case missingInput(String)
    case missingOutput(String)
    case unexpectedShape(String, [Int])
    case predictFailed(String, String)
    public var description: String {
        switch self {
        case .loadFailed(let p, let e): return "load failed \(p): \(e)"
        case .missingInput(let n): return "model missing input \(n)"
        case .missingOutput(let n): return "model missing output \(n)"
        case .unexpectedShape(let n, let s): return "\(n) shape \(s)"
        case .predictFailed(let p, let e): return "predict failed \(p): \(e)"
        }
    }
}

/// Cheap per-stage wall-clock collector (ns via CLOCK_MONOTONIC_RAW).
/// Each call records absolute (startNs, endNs) so a receipt can split
/// prefill from decode at the first head-call boundary.
public final class TimingLog {
    public struct Call { public var startNs: UInt64; public var endNs: UInt64
        public var ms: Double { Double(endNs - startNs) / 1e6 } }
    public struct Rec { public var count = 0; public var totalNs: UInt64 = 0
        public var perCall: [Double] = []; public var calls: [Call] = [] }
    public private(set) var stages: [String: Rec] = [:]
    public init() {}
    public static func nowNs() -> UInt64 {
        var ts = timespec(); clock_gettime(CLOCK_MONOTONIC_RAW, &ts)
        return UInt64(ts.tv_sec) * 1_000_000_000 + UInt64(ts.tv_nsec)
    }
    public func mark(_ stage: String, _ t0: UInt64) {
        let t1 = TimingLog.nowNs()
        var r = stages[stage] ?? Rec()
        r.count += 1; r.totalNs += (t1 - t0)
        r.perCall.append(Double(t1 - t0) / 1e6)
        r.calls.append(Call(startNs: t0, endNs: t1))
        stages[stage] = r
    }
    public func summary() -> String {
        stages.sorted { $0.key < $1.key }.map { (k, r) in
            let ms = Double(r.totalNs) / 1e6
            return String(format: "  %-12s n=%d total=%.1fms mean=%.2fms", (k as NSString).utf8String!, r.count, ms, ms / Double(max(1, r.count)))
        }.joined(separator: "\n")
    }
}

/// Resident physical footprint of this process (bytes), via mach task_info.
public func processFootprint() -> UInt64 {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.stride / MemoryLayout<integer_t>.stride)
    let kr = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
            task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
        }
    }
    return kr == KERN_SUCCESS ? UInt64(info.phys_footprint) : 0
}

/// Compute-unit selection for the residency discriminator. `.all` lets
/// CoreML pick (and may duplicate runtime/weights across CPU+GPU+ANE);
/// `.cpuAndNeuralEngine` excludes the GPU path. Set once at launch.
public var gComputeUnits: MLComputeUnits = .all

// MARK: - system memory telemetry (host_statistics64 + vm.swapusage)

private struct XswUsage { var total: UInt64 = 0; var used: UInt64 = 0;
    var avail: UInt64 = 0; var pagesize: UInt32 = 0; var encrypted: Bool = false }

public struct MemStats {
    public var physFootprintMB: Double = 0
    public var memFreePct: Double = 0
    public var compressedMB: Double = 0
    public var swapTotalMB: Double = 0
    public var swapUsedMB: Double = 0
    public var desc: String {
        String(format: "rss=%lldMB free=%.1f%% compressed=%lldMB swap=%lld/%lldMB",
               Int64(physFootprintMB), memFreePct, Int64(compressedMB),
               Int64(swapUsedMB), Int64(swapTotalMB))
    }
}

public func memStats() -> MemStats {
    var s = MemStats()
    s.physFootprintMB = Double(processFootprint()) / 1e6
    var vs = vm_statistics64()
    var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64>.stride / MemoryLayout<integer_t>.stride)
    let host = mach_host_self()
    let kr = withUnsafeMutablePointer(to: &vs) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
            host_statistics64(host, HOST_VM_INFO64, $0, &count)
        }
    }
    if kr == KERN_SUCCESS {
        var ps = vm_size_t(0); host_page_size(host, &ps)
        let page = Double(ps)
        var phys = host_basic_info()
        var hc = mach_msg_type_number_t(MemoryLayout<host_basic_info>.stride / MemoryLayout<integer_t>.stride)
        _ = withUnsafeMutablePointer(to: &phys) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(hc)) {
                host_info(host, HOST_BASIC_INFO, $0, &hc)
            }
        }
        let freeB = Double(vs.free_count + vs.speculative_count) * page
        s.memFreePct = phys.max_mem > 0 ? 100.0 * freeB / Double(phys.max_mem) : 0
        s.compressedMB = Double(vs.compressor_page_count) * page / 1e6
    }
    var xsw = XswUsage()
    var sz = MemoryLayout<XswUsage>.stride
    if sysctlbyname("vm.swapusage", &xsw, &sz, nil, 0) == 0 {
        s.swapTotalMB = Double(xsw.total) / 1e6
        s.swapUsedMB = Double(xsw.used) / 1e6
    }
    return s
}

// MARK: - reference store + vector error metrics (teacher-forced validation)

/// Loads the HF fp16 oracle reference vectors produced on Dell.
/// Layout: <dir>/manifest.json + <dir>/<name>.bin (raw little-endian f32).
public final class RefStore {
    public let dir: String
    private var manifest: [String: Any] = [:]
    public init?(dir: String?) {
        guard let d = dir, !d.isEmpty else { return nil }
        self.dir = d
        let mp = "\(d)/manifest.json"
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: mp)),
              let m = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        self.manifest = m
    }
    /// Load <dir>/<name>.bin as [Float] (f32 LE). nil if absent.
    public func vec(_ name: String) -> [Float]? {
        guard let d = try? Data(contentsOf: URL(fileURLWithPath: "\(dir)/\(name).bin")) else { return nil }
        return d.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
    }
    public func step(_ k: Int) -> [String: Any]? {
        (manifest["steps"] as? [[String: Any]])?.first { ($0["k"] as? Int) == k }
    }
    public var count: Int { (manifest["steps"] as? [[String: Any]])?.count ?? 0 }
}
public var gRef: RefStore? = nil

/// Whole-vector error metrics between CoreML (a) and reference (b).
/// maxAbs/meanAbs/RMSE in the same units as the tensors; cosine in [-1,1];
/// normRatio = |a|/|b|.
public func vecError(_ a: [Float], _ b: [Float]) -> [String: Any] {
    let n = min(a.count, b.count)
    guard n > 0 else { return [:] }
    var maxAbs: Float = 0, sumAbs: Float = 0, sumSq: Float = 0
    var dot: Float = 0, na: Float = 0, nb: Float = 0
    for i in 0..<n {
        let d = a[i] - b[i], ad = abs(d)
        if ad > maxAbs { maxAbs = ad }
        sumAbs += ad; sumSq += d * d
        dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]
    }
    let cos = (na > 0 && nb > 0) ? dot / (sqrt(na) * sqrt(nb)) : 0
    return ["maxAbs": maxAbs, "meanAbs": sumAbs / Float(n),
            "rmse": sqrt(sumSq / Float(n)), "cosine": cos,
            "normRatio": nb > 0 ? sqrt(na) / sqrt(nb) : 0]
}

/// Load an .mlmodelc on a background thread while the caller prints a
/// heartbeat every 15s — keeps the seat stall watchdog fed through the
/// multi-hundred-second device-side specialization of a ~1.6GB package.
public func loadMLModelHeartbeated(path: String, stage: String, timing: TimingLog?) throws -> MLModel {
    let cfg = MLModelConfiguration(); cfg.computeUnits = gComputeUnits
    let url = URL(fileURLWithPath: path)
    final class Box { var result: Result<MLModel, Error>? = nil }
    let box = Box()
    let done = DispatchSemaphore(value: 0)
    DispatchQueue.global(qos: .userInitiated).async {
        do { box.result = .success(try MLModel(contentsOf: url, configuration: cfg)) }
        catch { box.result = .failure(error) }
        done.signal()
    }
    let t0 = TimingLog.nowNs()
    var waited: UInt64 = 0
    while done.wait(timeout: .now() + 15) == .timedOut {
        waited += 15
        let nm = (path as NSString).lastPathComponent
        FileHandle.standardError.write(
            "load_wait \(nm) \(waited)s rss=\(processFootprint() >> 20)MB\n".data(using: .utf8)!)
        if waited > 2400 { fatalError("load exceeded 2400s: \(path)") }
    }
    timing?.mark(stage, t0)
    return try box.result!.get()
}

/// Run a synchronous prediction on a background queue with a 15s stderr
/// heartbeat — keeps the seat watchdog fed while a single eval faults
/// file-backed model pages back in under swap pressure.
public func predictionHeartbeated(model: MLModel, provider: MLFeatureProvider, tag: String) throws -> MLFeatureProvider {
    final class Box { var result: Result<MLFeatureProvider, Error>? = nil }
    let box = Box()
    let done = DispatchSemaphore(value: 0)
    DispatchQueue.global(qos: .userInitiated).async {
        do { box.result = .success(try model.prediction(from: provider)) }
        catch { box.result = .failure(error) }
        done.signal()
    }
    var waited: UInt64 = 0
    while done.wait(timeout: .now() + 15) == .timedOut {
        waited += 15
        FileHandle.standardError.write(
            "eval_wait \(tag) \(waited)s rss=\(processFootprint() >> 20)MB\n".data(using: .utf8)!)
        if waited > 2400 { fatalError("eval exceeded 2400s: \(tag)") }
    }
    return try box.result!.get()
}

// MARK: - fp16 helpers

@inline(__always) func fp16ToFloat(_ bits: UInt16) -> Float {
    Float(Float16(bitPattern: bits))
}

// MARK: - Embedding adapter (token gather from segpack v2 weight.bin)

public final class CoreMLEmbeddingAdapter: EmbeddingAdapter {
    public let window: Int
    private let H: Int
    private let embedBase: UInt64   // data_offset of embed_tokens in v2 bin
    private let rowBytes: Int
    private let mapData: Data       // mmap'd weight.bin
    public let timing: TimingLog

    /// weightBinPath: segpack/final_head weight.bin (v2 header, embed_tokens blob).
    /// embedBase: manifest data_offset for model.embed_tokens.weight (128 for embed_head).
    public init(weightBinPath: String, embedBase: UInt64 = 128, hiddenSize: Int = 2048,
                vocabSize: Int = 128000, window: Int = 16, timing: TimingLog) throws {
        self.window = window
        self.H = hiddenSize
        self.embedBase = embedBase
        self.rowBytes = hiddenSize * 2
        self.timing = timing
        let url = URL(fileURLWithPath: weightBinPath)
        let attrs = try FileManager.default.attributesOfItem(atPath: weightBinPath)
        let need = embedBase + UInt64(vocabSize) * UInt64(rowBytes)
        let sz = (attrs[.size] as? NSNumber)?.uint64Value ?? 0
        guard sz >= need else {
            throw MacAdapterError.loadFailed(weightBinPath, "weight.bin \(sz) < need \(need)")
        }
        self.mapData = try Data(contentsOf: url, options: .mappedIfSafe)
    }

    /// tokens[i] == nil -> pad (never produced under D1.1; zero row emitted).
    public func embed(tokens: [TokenID?], window w: StepWindow) -> TensorData {
        let t0 = TimingLog.nowNs()
        let S = tokens.count
        var bytes = [UInt8](repeating: 0, count: S * rowBytes)
        mapData.withUnsafeBytes { raw in
            let base = raw.baseAddress!
            for (i, t) in tokens.enumerated() {
                guard let tok = t else { continue }
                let off = Int(embedBase) + Int(tok) * rowBytes
                memcpy(&bytes[i * rowBytes], base.advanced(by: off), rowBytes)
            }
        }
        timing.mark("embed", t0)
        return TensorData(shape: [1, S, H], bytes: bytes)
    }
}

// MARK: - Segment adapter (one compiled package per width)

public final class CoreMLSegmentAdapter: SegmentAdapter {
    public let segment: SegmentID
    public let window: Int              // widest window = 16 (S16 package)
    public let layers: [LayerID]

    private let schedule: LayerSchedule
    private let geometry: ModelGeometry
    private let timing: TimingLog

    // Per-width model handles: [1: s1Model, 16: s16Model]
    private var models: [Int: MLModel] = [:]
    private var modelPaths: [Int: String]
    private var ioByWidth: [Int: IO] = [:]

    // Host-side persistent buffers per width.
    private struct IO {
        var hidden: MLMultiArray           // [1,S,2048]
        var cosIn: MLMultiArray            // [1,S,64]
        var sinIn: MLMultiArray            // [1,S,64]
        var mask: MLMultiArray             // [1,1,1,512]
        var kvIn: [RecurrentStateKey: MLMultiArray] = [:]
        var kvName: [RecurrentStateKey: String] = [:]      // state key -> feature name in
        var convIn: [RecurrentStateKey: MLMultiArray] = [:]
        var convName: [RecurrentStateKey: String] = [:]
        var outNameKV: [String: RecurrentStateKey] = [:]   // feature name out -> state key
        var provider: MLDictionaryFeatureProvider? = nil
    }

    // positions written into this segment's KV window (drives mask)
    private var positionsWritten = 0

    public init(segment: SegmentID, layers: [LayerID],
                s1Path: String?, s16Path: String?,
                schedule: LayerSchedule, geometry: ModelGeometry,
                timing: TimingLog) {
        self.segment = segment
        self.layers = layers
        self.window = 16
        self.schedule = schedule
        self.geometry = geometry
        self.timing = timing
        var mp: [Int: String] = [:]
        if let p = s1Path { mp[1] = p }
        if let p = s16Path { mp[16] = p }
        self.modelPaths = mp
    }

    /// Deterministic fresh state: zeros for every owned cache key.
    public func freshState(serial: Int) -> SegmentState {
        positionsWritten = 0
        let st = SegmentState(segment: segment, layers: Set(layers), serial: serial)
        for layer in layers.sorted() {
            for kind in LayerCacheLaw.kinds(for: layer, schedule: schedule) {
                let shape = geometry.stateShape(layer: layer, kind: kind, schedule: schedule)
                let n = shape.reduce(1, *) * 2
                _ = st.write(RecurrentStateKey(layer: layer, kind: kind),
                             TensorData(shape: shape, bytes: [UInt8](repeating: 0, count: n)))
            }
        }
        return st
    }

    private func loadModel(width: Int) throws -> MLModel {
        if let m = models[width] { return m }
        guard let path = modelPaths[width] else {
            throw MacAdapterError.loadFailed("seg\(segment.ordinal)", "no package for width \(width)")
        }
        let m: MLModel
        do {
            m = try loadMLModelHeartbeated(path: path,
                                           stage: "load_seg\(segment.ordinal)_s\(width)",
                                           timing: timing)
        } catch {
            throw MacAdapterError.loadFailed(path, "\(error)")
        }
        models[width] = m
        return m
    }

    /// Inject an already-loaded MLModel handle so an eval reuses it — used by
    /// `mat` mode to separate MLModel-load footprint from first-eval
    /// materialization without a second load.
    public func preloadLoaded(_ m: MLModel, width: Int) { models[width] = m }

    private static let kvInRe = try! NSRegularExpression(pattern: #"kv_in_l(\d+)_(K|V)$"#)
    private static let convInRe = try! NSRegularExpression(pattern: #"conv_in_l(\d+)$"#)
    private static let kvOutRe = try! NSRegularExpression(pattern: #"layer_(\d+)_attn_kv_out_(K|V)$"#)
    private static let convOutRe = try! NSRegularExpression(pattern: #"layer_(\d+)_liv_conv_cache_out$"#)

    private func buildIO(width: Int, model: MLModel) throws -> IO {
        let S = width, H = geometry.hiddenSize, CTX = geometry.kvCtx
        let NKV = geometry.numKVHeads, HD = geometry.headDim, LC = geometry.convLCache - 1
        var io = IO(
            hidden: try MLMultiArray(shape: [1, NSNumber(value: S), NSNumber(value: H)], dataType: .float16),
            cosIn: try MLMultiArray(shape: [1, NSNumber(value: S), NSNumber(value: HD)], dataType: .float16),
            sinIn: try MLMultiArray(shape: [1, NSNumber(value: S), NSNumber(value: HD)], dataType: .float16),
            mask: try MLMultiArray(shape: [1, 1, 1, NSNumber(value: CTX)], dataType: .float16)
        )
        let kvShape: [NSNumber] = [1, NSNumber(value: NKV), NSNumber(value: CTX), NSNumber(value: HD)]
        let convShape: [NSNumber] = [1, NSNumber(value: LC), NSNumber(value: H)]  // rank-3 [1,2,2048]

        func matchLK(_ re: NSRegularExpression, _ name: String) -> (Int, String)? {
            let r = NSRange(name.startIndex..., in: name)
            guard let m = re.firstMatch(in: name, range: r), m.numberOfRanges == 3,
                  let lrange = Range(m.range(at: 1), in: name),
                  let krange = Range(m.range(at: 2), in: name) else { return nil }
            return (Int(name[lrange])!, String(name[krange]))
        }
        func matchL(_ re: NSRegularExpression, _ name: String) -> Int? {
            let r = NSRange(name.startIndex..., in: name)
            guard let m = re.firstMatch(in: name, range: r), m.numberOfRanges == 2,
                  let lrange = Range(m.range(at: 1), in: name) else { return nil }
            return Int(name[lrange])!
        }

        func declaredShape(_ name: String) -> [Int]? {
            model.modelDescription.inputDescriptionsByName[name]?
                .multiArrayConstraint?.shape.map { $0.intValue }
        }
        for name in model.modelDescription.inputDescriptionsByName.keys {
            if let (l, kind) = matchLK(Self.kvInRe, name) {
                let key = RecurrentStateKey(layer: LayerID(l), kind: kind == "K" ? .key : .value)
                if let ds = declaredShape(name), ds != kvShape.map({ $0.intValue }) {
                    throw MacAdapterError.unexpectedShape(name, ds)
                }
                io.kvIn[key] = try MLMultiArray(shape: kvShape, dataType: .float16)
                io.kvName[key] = name
            } else if let l = matchL(Self.convInRe, name) {
                let key = RecurrentStateKey(layer: LayerID(l), kind: .conv)
                if let ds = declaredShape(name), ds != convShape.map({ $0.intValue }) {
                    throw MacAdapterError.unexpectedShape(name, ds)
                }
                io.convIn[key] = try MLMultiArray(shape: convShape, dataType: .float16)
                io.convName[key] = name
            }
        }
        for name in model.modelDescription.outputDescriptionsByName.keys {
            if let (l, kind) = matchLK(Self.kvOutRe, name) {
                io.outNameKV[name] = RecurrentStateKey(layer: LayerID(l), kind: kind == "K" ? .key : .value)
            } else if let l = matchL(Self.convOutRe, name) {
                io.outNameKV[name] = RecurrentStateKey(layer: LayerID(l), kind: .conv)
            }
        }
        var dict: [String: MLFeatureValue] = [
            "hidden_states": MLFeatureValue(multiArray: io.hidden),
            "cos_in": MLFeatureValue(multiArray: io.cosIn),
            "sin_in": MLFeatureValue(multiArray: io.sinIn),
            "cache_mask_in": MLFeatureValue(multiArray: io.mask),
        ]
        for (k, arr) in io.kvIn { dict[io.kvName[k]!] = MLFeatureValue(multiArray: arr) }
        for (k, arr) in io.convIn { dict[io.convName[k]!] = MLFeatureValue(multiArray: arr) }
        io.provider = try MLDictionaryFeatureProvider(dictionary: dict)
        ioByWidth[width] = io
        return io
    }

    private func fillRope(_ io: inout IO, positions: [Int]) {
        let HD = geometry.headDim, half = HD / 2, S = positions.count
        let theta = 10_000_000.0  // rope_theta = 1e7 (packet model_identity)
        let cPtr = io.cosIn.dataPointer.bindMemory(to: UInt16.self, capacity: S * HD)
        let sPtr = io.sinIn.dataPointer.bindMemory(to: UInt16.self, capacity: S * HD)
        for (s, pos) in positions.enumerated() {
            for i in 0..<half {
                let inv = 1.0 / pow(theta, Double(2 * i) / Double(HD))
                let a = Double(pos) * inv
                var c = Float16(Float(cos(a)))
                var sn = Float16(Float(sin(a)))
                memcpy(cPtr + s * HD + i, &c, 2); memcpy(cPtr + s * HD + half + i, &c, 2)
                memcpy(sPtr + s * HD + i, &sn, 2); memcpy(sPtr + s * HD + half + i, &sn, 2)
            }
        }
    }

    private func fillMask(_ io: inout IO) {
        let CTX = geometry.kvCtx
        let valid = min(positionsWritten, CTX)
        let firstValid = CTX - valid
        let p = io.mask.dataPointer.bindMemory(to: UInt16.self, capacity: CTX)
        var negInf = Float16(-Float.infinity)
        var zero = Float16(0)
        for j in 0..<CTX {
            if j >= firstValid { memcpy(p + j, &zero, 2) } else { memcpy(p + j, &negInf, 2) }
        }
    }

    public func evaluate(hidden h: HiddenState, window w: StepWindow, state: SegmentState) -> TensorData {
        let width = w.slots.count
        do {
            // Memory law on 8GB: prefill-width packages are dead weight during
            // decode. Evict the S=16 handle at the prefill->decode boundary so
            // MODE B's resident set shrinks to 3xS1 + head.
            if w.phase == .decode && models[16] != nil {
                models[16] = nil
                ioByWidth[16] = nil
            }
            let model = try loadModel(width: width)
            var io: IO
            if let cached = ioByWidth[width] { io = cached } else { io = try buildIO(width: width, model: model) }

            // positions for rope, all slots real under D1.1
            let positions = w.slots.map { s -> Int in
                if case .real(let p, _) = s.occupancy { return p }; return -1
            }
            let S = positions.count
            fillRope(&io, positions: positions)
            fillMask(&io)

            // hidden in: [1,S,2048] fp16
            _ = h.data.bytes.withUnsafeBytes { raw in
                memcpy(io.hidden.dataPointer, raw.baseAddress!, min(raw.count, S * geometry.hiddenSize * 2))
            }

            // state -> input buffers (journal read)
            for (key, arr) in io.kvIn {
                if let td = state.read(key) {
                    _ = td.bytes.withUnsafeBytes { raw in
                        memcpy(arr.dataPointer, raw.baseAddress!, min(raw.count, arr.count * 2))
                    }
                }
            }
            for (key, arr) in io.convIn {
                if let td = state.read(key) {
                    _ = td.bytes.withUnsafeBytes { raw in
                        memcpy(arr.dataPointer, raw.baseAddress!, min(raw.count, arr.count * 2))
                    }
                }
            }

            let t0 = TimingLog.nowNs()
            let out: MLFeatureProvider
            do {
                out = try predictionHeartbeated(model: model, provider: io.provider!,
                                                tag: "seg\(segment.ordinal)s\(width)")
            } catch {
                throw MacAdapterError.predictFailed("seg\(segment.ordinal)s\(width)", "\(error)")
            }
            timing.mark("seg\(segment.ordinal)", t0)

            // outputs -> state (journal write)
            for (name, key) in io.outNameKV {
                guard let mv = out.featureValue(for: name)?.multiArrayValue else {
                    throw MacAdapterError.missingOutput(name)
                }
                let n = mv.count * 2
                var bytes = [UInt8](repeating: 0, count: n)
                memcpy(&bytes, mv.dataPointer, n)
                _ = state.write(key, TensorData(shape: mv.shape.map { $0.intValue }, bytes: bytes))
            }

            guard let hOut = out.featureValue(for: "out")?.multiArrayValue else {
                throw MacAdapterError.missingOutput("out")
            }
            let nOut = hOut.count * 2
            var outBytes = [UInt8](repeating: 0, count: nOut)
            memcpy(&outBytes, hOut.dataPointer, nOut)

            // bisection evidence: sha256 of the last-position hidden as f32,
            // comparable to the HF oracle's per-boundary shas.
            let lastPos = positions.last ?? -1
            let rowBase = (S - 1) * geometry.hiddenSize  // element offset of last slot
            var f32 = [Float](repeating: 0, count: geometry.hiddenSize)
            let hp = hOut.dataPointer.bindMemory(to: UInt16.self, capacity: hOut.count)
            for i in 0..<geometry.hiddenSize { f32[i] = fp16ToFloat(hp[rowBase + i]) }
            let sha = f32.withUnsafeBytes { SHA256.hash(data: $0).map { String(format: "%02x", $0) }.joined() }
            let f8 = f32.prefix(8).map { String(format: "%.4f", $0) }.joined(separator: ",")
            FileHandle.standardError.write(
                "HID seg\(segment.ordinal)s\(width) pos=\(lastPos) sha=\(String(sha.prefix(16))) first8=[\(f8)]\n"
                    .data(using: .utf8)!)
            // whole-vector error vs oracle ref at this boundary/position.
            if let ref = gRef, let rv = ref.vec("seg\(segment.ordinal)_pos\(lastPos)") {
                let e = vecError(f32, rv)
                FileHandle.standardError.write(String(format:
                    "VECERR seg%d pos=%d maxAbs=%.4f meanAbs=%.5f rmse=%.5f cos=%.5f normr=%.4f\n",
                    segment.ordinal, lastPos,
                    e["maxAbs"] as? Float ?? 0, e["meanAbs"] as? Float ?? 0,
                    e["rmse"] as? Float ?? 0, e["cosine"] as? Float ?? 0,
                    e["normRatio"] as? Float ?? 0).data(using: .utf8)!)
            }

            positionsWritten += S
            return TensorData(shape: hOut.shape.map { $0.intValue }, bytes: outBytes)
        } catch {
            fatalError("CoreMLSegmentAdapter \(segment.name): \(error)")
        }
    }
}

// MARK: - Head adapter (final RMSNorm + tied lm_head package)

public final class CoreMLHeadAdapter: HeadAdapter {
    public let window = 1
    private var model: MLModel?
    private let path: String
    private var inArr: MLMultiArray!
    private var provider: MLDictionaryFeatureProvider!
    private let H: Int, V: Int
    private let timing: TimingLog
    private var lastHeadEndNs: UInt64? = nil

    // Teacher-forced probe state: per head-call record of argmax/rank/
    // margin/vecerr vs the HF oracle. callIndex tracks which generation
    // step this call produces (0 = prefill head call -> expected[0]).
    public var expectedTokens: [Int] = []
    // Semantic-probe surface: when non-empty, every head call emits a
    // PROBE_JSON line with softmax probabilities for these token ids.
    public var probeIDs: [Int] = []
    // Multi-position probe: when non-empty, nextToken ignores the passed
    // realSlotOffset and emits one PROBE_JSON per listed row offset of the
    // window's hidden output. Each line carries {"offset": o, "probs", "abs"}.
    public var probeOffsets: [Int] = []
    // Diagnostic-only full-vocabulary telemetry. Zero preserves the canonical
    // PROBE_JSON shape and scoring behavior.
    public var diagnosticTopK: Int = 0
    public var callIndex = 0
    public private(set) var probeLog: [[String: Any]] = []

    public init(path: String, hiddenSize: Int = 2048, vocabSize: Int = 128000, timing: TimingLog) {
        self.path = path
        self.H = hiddenSize
        self.V = vocabSize
        self.timing = timing
    }

    private func ensureLoaded() throws {
        if model == nil {
            model = try loadMLModelHeartbeated(path: path, stage: "load_head", timing: timing)
        }
        if inArr == nil {
            inArr = try MLMultiArray(shape: [1, 1, NSNumber(value: H)], dataType: .float16)
            provider = try MLDictionaryFeatureProvider(dictionary: ["lfm_h_in": MLFeatureValue(multiArray: inArr)])
        }
    }

    /// Inject an already-loaded MLModel handle (mat mode) so load footprint is
    /// measured separately from first-eval materialization.
    public func preloadLoaded(_ m: MLModel) { model = m }

    /// Materialize the fp16 logits for one hidden row into f32.
    private func evalLogits(hidden h: HiddenState, rowOffset: Int) throws -> [Float] {
        try ensureLoaded()
        let rowBytes = H * 2
        _ = h.data.bytes.withUnsafeBytes { raw in
            memcpy(inArr.dataPointer, raw.baseAddress!.advanced(by: rowOffset * rowBytes), rowBytes)
        }
        let t0 = TimingLog.nowNs()
        let out = try predictionHeartbeated(model: model!, provider: provider, tag: "head")
        timing.mark("head", t0)
        guard let logits = out.featureValue(for: "logits")?.multiArrayValue else {
            throw MacAdapterError.missingOutput("logits")
        }
        let p = logits.dataPointer.bindMemory(to: UInt16.self, capacity: V)
        var lf = [Float](repeating: 0, count: V)
        for v in 0..<V { lf[v] = fp16ToFloat(p[v]) }
        return lf
    }

    /// Softmax probe over probeIDs at one hidden row; emits PROBE_JSON.
    private func emitProbe(hidden h: HiddenState, rowOffset: Int) throws -> TokenID {
        let lf = try evalLogits(hidden: h, rowOffset: rowOffset)
        var best: Float = -.greatestFiniteMagnitude
        var bestIdx = 0
        var mx = lf[0]
        for v in 0..<V {
            if lf[v] > best { best = lf[v]; bestIdx = v }
            if lf[v] > mx { mx = lf[v] }
        }
        var acc = 0.0
        var exps = [Double](repeating: 0, count: probeIDs.count)
        for (j, id) in probeIDs.enumerated() {
            let e = exp(Double(lf[id] - mx))
            exps[j] = e
            acc += e
        }
        var vocabAcc = 0.0
        for v in 0..<V { vocabAcc += exp(Double(lf[v] - mx)) }
        var probs: [String: Any] = [:]
        var abs: [String: Any] = [:]
        for (j, id) in probeIDs.enumerated() {
            probs[String(id)] = acc > 0 ? exps[j] / acc : 0
            abs[String(id)] = vocabAcc > 0 ? exps[j] / vocabAcc : 0
        }
        var payload: [String: Any] = ["offset": rowOffset, "probs": probs, "abs": abs]
        if diagnosticTopK > 0 {
            let ranked = topKLogits(lf, k: diagnosticTopK)
            payload["argmax"] = bestIdx
            payload["top"] = ranked.map { item -> [String: Any] in
                let e = exp(Double(item.logit - mx))
                return [
                    "id": item.id,
                    "logit": Double(item.logit),
                    "abs": vocabAcc > 0 ? e / vocabAcc : 0,
                ]
            }
        }
        FileHandle.standardOutput.write(("PROBE_JSON " + String(data: try! JSONSerialization.data(withJSONObject: payload, options: []), encoding: .utf8)! + "\n").data(using: .utf8)!)
        return TokenID(bestIdx)
    }

    /// hidden: [1,S,2048] fp16; realSlotOffset selects the row.
    public func nextToken(hidden h: HiddenState, realSlotOffset: Int, window w: StepWindow) -> TokenID {
        do {
            try ensureLoaded()
            if !probeOffsets.isEmpty {
                var last = TokenID(0)
                for off in probeOffsets {
                    last = try emitProbe(hidden: h, rowOffset: off)
                }
                return last
            }
            let lf = try evalLogits(hidden: h, rowOffset: realSlotOffset)
            var best: Float = -.greatestFiniteMagnitude
            var bestIdx = 0
            for v in 0..<V {
                if lf[v] > best { best = lf[v]; bestIdx = v }
            }
            var top: [(Int, Float)] = []
            top.reserveCapacity(5)
            for v in 0..<V {
                let f = lf[v]
                if top.count < 5 || f > top.last!.1 {
                    top.append((v, f)); top.sort { $0.1 > $1.1 }; top = Array(top.prefix(5))
                }
            }
            // teacher-forced probe: rank/margin/vecerr of the expected token.
            let k = callIndex
            if k < expectedTokens.count {
                let exp = expectedTokens[k]
                let expLogit = lf[exp]
                var rank = 1
                for v in 0..<V where lf[v] > expLogit { rank += 1 }
                let mlMargin = top.count >= 2 ? top[0].1 - top[1].1 : 0
                let st = gRef?.step(k)
                let hfMargin = (st?["hf_margin"] as? NSNumber)?.floatValue ?? -1
                var cls = "EXACT"
                if bestIdx != exp {
                    if hfMargin >= 0 && hfMargin < 0.02 { cls = "REFERENCE_EXACT_TIE" }
                    else if rank <= 3 && (top[0].1 - expLogit) < 1.0 { cls = "NEAR_TIE" }
                    else { cls = "HIGH_MARGIN_MISMATCH" }
                }
                var rec: [String: Any] = ["k": k, "expected": exp, "argmax": bestIdx,
                    "expected_rank": rank, "expected_logit": expLogit,
                    "ml_margin": mlMargin, "class": cls]
                var vecs = ""
                if let ref = gRef, let rl = ref.vec("logits_step\(k)") {
                    let e = vecError(lf, rl)
                    rec["logit_maxAbs"] = e["maxAbs"]; rec["logit_rmse"] = e["rmse"]
                    rec["logit_cosine"] = e["cosine"]; rec["logit_normr"] = e["normRatio"]
                    rec["logit_meanAbs"] = e["meanAbs"]
                    vecs = String(format: " lvmaxAbs=%.4f lvrmse=%.5f lvcos=%.5f lvnormr=%.4f",
                                  e["maxAbs"] as? Float ?? 0, e["rmse"] as? Float ?? 0,
                                  e["cosine"] as? Float ?? 0, e["normRatio"] as? Float ?? 0)
                }
                probeLog.append(rec)
                FileHandle.standardError.write(String(format:
                    "TPOS k=%d exp=%d argmax=%d rank=%d mlMargin=%.4f hfMargin=%.4f cls=%@%@\n",
                    k, exp, bestIdx, rank, mlMargin, hfMargin, cls, vecs).data(using: .utf8)!)
                FileHandle.standardError.write(String(format:
                    "LOGIT top5=%@ exp%d_logit=%.4f exp%d_rank=%d\n",
                    top.map { "\($0.0):\(String(format: "%.3f", $0.1))" }.joined(separator: ",") as NSString,
                    exp, expLogit, exp, rank).data(using: .utf8)!)
            } else {
                FileHandle.standardError.write(String(format:
                    "LOGIT top5=%@\n",
                    top.map { "\($0.0):\(String(format: "%.3f", $0.1))" }.joined(separator: ",") as NSString)
                    .data(using: .utf8)!)
            }
            if !probeIDs.isEmpty {
                var mx = lf[0]
                for v in 0..<V where lf[v] > mx { mx = lf[v] }
                var acc = 0.0
                var exps = [Double](repeating: 0, count: probeIDs.count)
                for (j, id) in probeIDs.enumerated() {
                    let e = exp(Double(lf[id] - mx))
                    exps[j] = e
                    acc += e
                }
                var vocabAcc = 0.0
                for v in 0..<V { vocabAcc += exp(Double(lf[v] - mx)) }
                var probs: [String: Any] = [:]
                var abs: [String: Any] = [:]
                for (j, id) in probeIDs.enumerated() {
                    probs[String(id)] = acc > 0 ? exps[j] / acc : 0
                    abs[String(id)] = vocabAcc > 0 ? exps[j] / vocabAcc : 0
                }
                FileHandle.standardOutput.write(("PROBE_JSON " + String(data: try! JSONSerialization.data(withJSONObject: ["probs": probs, "abs": abs], options: []), encoding: .utf8)! + "\n").data(using: .utf8)!)
            }
            callIndex += 1
            // live per-token tick for the seat watchdog: head calls are
            // exactly one per produced token (end-of-prefill + each decode).
            // Emit in BOTH phases — silent prefill under swap pressure reads
            // as a stall otherwise.
            let now = TimingLog.nowNs()
            if let prev = lastHeadEndNs {
                FileHandle.standardError.write(
                    String(format: "tick_ms=%.3f tok=%d pos=%d ph=\(w.phase == .decode ? "d" : "p")\n",
                           Double(now - prev) / 1e6, bestIdx,
                           w.slots.first.map { s -> Int in
                               if case .real(let pp, _) = s.occupancy { return pp }; return -1
                           } ?? -1).data(using: .utf8)!)
            }
            lastHeadEndNs = now
            return TokenID(bestIdx)
        } catch {
            fatalError("CoreMLHeadAdapter: \(error)")
        }
    }
}

#endif
