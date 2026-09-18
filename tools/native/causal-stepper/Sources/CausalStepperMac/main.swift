// main.swift — CausalStepperMac: the narrow D1.1 Mac execution driver.
//
// Receipt-oriented harness for the 2.6B 3x10 KVIO package set on Neo.
// Usage:
//   CausalStepperMac load      --packages <dir>
//   CausalStepperMac residency --packages <dir>
//   CausalStepperMac run       --packages <dir> --embed <weight.bin> \
//                              --fixture <traj.json> --mode a|b [--steps N]
//
// --mode a = all-S1 prefill+decode (simplest causal baseline).
// --mode b = production routing [16,1,1] prefill then strict S=1 decode.
import Foundation
import CausalStepperCore

#if canImport(CoreML)
import CoreML

func eprint(_ s: String) { fputs(s + "\n", stderr); fflush(stderr) }

struct Fixture: Decodable {
    let prompt_ids: [Int]
    let hf_tokens: [Int]
}

struct Args {
    var mode: String = "run"
    var packages: String = ""
    var embed: String = ""
    var fixture: String = ""
    var parity: String = "a"
    var steps: Int = 32
    var cu: String = "all"       // all | cne | cpu  -> MLComputeUnits
    var oracle: String = ""      // dir with manifest.json + <name>.bin refs
    var probeIds: String = ""      // probe token ids
    var only: String = ""        // mat mode: restrict to one package name
    static func parse() -> Args {
        var a = Args()
        var it = CommandLine.arguments.dropFirst()
        if let first = it.first { a.mode = first; it = it.dropFirst() }
        while let k = it.first {
            it = it.dropFirst()
            switch k {
            case "--packages": a.packages = it.first ?? ""; it = it.dropFirst()
            case "--embed": a.embed = it.first ?? ""; it = it.dropFirst()
            case "--fixture": a.fixture = it.first ?? ""; it = it.dropFirst()
            case "--mode": a.parity = it.first ?? "a"; it = it.dropFirst()
            case "--steps": a.steps = Int(it.first ?? "32") ?? 32; it = it.dropFirst()
            case "--compute-units": a.cu = it.first ?? "all"; it = it.dropFirst()
            case "--oracle": a.oracle = it.first ?? ""; it = it.dropFirst()
            case "--probe-ids": a.probeIds = it.first ?? ""; it = it.dropFirst()
            case "--only": a.only = it.first ?? ""; it = it.dropFirst()
            default: eprint("unknown arg \(k)"); _ = it.dropFirst()
            }
        }
        return a
    }
}

var args = Args.parse()
let schedule = LayerSchedule.lfm25_2p6b
let geometry = ModelGeometry.lfm25_2p6b
let partition = PartitionMap.lfm25_2p6b_3x10
let timing = TimingLog()

// Compute-unit + oracle wiring must precede any MLModel construction.
switch args.cu {
case "cne", "cpuAndNeuralEngine": gComputeUnits = .cpuAndNeuralEngine
case "cpu", "cpuOnly":            gComputeUnits = .cpuOnly
default:                          gComputeUnits = .all
}
gRef = RefStore(dir: args.oracle)
eprint(String(format: "CONFIG compute_units=%@ oracle=%@",
              args.cu as NSString, gRef != nil ? args.oracle as NSString : "none"))

func pkgPath(_ name: String) -> String { "\(args.packages)/\(name).mlmodelc" }

func makeAdapters(withS16: Bool = true) -> (embedding: CoreMLEmbeddingAdapter,
                        segments: [SegmentID: SegmentAdapter],
                        head: CoreMLHeadAdapter) {
    let emb = try! CoreMLEmbeddingAdapter(weightBinPath: args.embed, timing: timing)
    var segs: [SegmentID: SegmentAdapter] = [:]
    for seg in partition.orderedSegments {
        let i = seg.ordinal
        segs[seg] = CoreMLSegmentAdapter(
            segment: seg, layers: partition.layersBySegment[seg]!,
            s1Path: pkgPath("segment_\(i)_s1_ctx512_kvio"),
            s16Path: withS16 ? pkgPath("segment_\(i)_s16_ctx512_kvio_prefill") : nil,
            schedule: schedule, geometry: geometry, timing: timing)
    }
    return (emb, segs, CoreMLHeadAdapter(path: pkgPath("final_head_s1_2p6b"), timing: timing))
}

func loadFixture() -> Fixture {
    let d = try! Data(contentsOf: URL(fileURLWithPath: args.fixture))
    return try! JSONDecoder().decode(Fixture.self, from: d)
}

func loadModel(_ path: String) throws -> (MLModel, Double) {
    let t0 = TimingLog.nowNs()
    let m = try loadMLModelHeartbeated(path: path, stage: "load", timing: nil)
    return (m, Double(TimingLog.nowNs() - t0) / 1e6)
}

let allPackages = [
    "final_head_s1_2p6b",
    "segment_0_s1_ctx512_kvio", "segment_1_s1_ctx512_kvio", "segment_2_s1_ctx512_kvio",
    "segment_0_s16_ctx512_kvio_prefill", "segment_1_s16_ctx512_kvio_prefill",
    "segment_2_s16_ctx512_kvio_prefill",
]

switch args.mode {

case "load":
    var results: [[String: Any]] = []
    for n in allPackages {
        let p = pkgPath(n)
        let rss0 = processFootprint()
        do {
            let (m, ms) = try loadModel(p)
            let rss1 = processFootprint()
            let desc = m.modelDescription
            let nin = desc.inputDescriptionsByName.count
            let nout = desc.outputDescriptionsByName.count
            eprint(String(format: "LOAD_OK %-46@ %8.1fms  rss %+lld MB  in=%d out=%d",
                          n as NSString, ms, (Int64(rss1) - Int64(rss0)) >> 20, nin, nout))
            // ABI census: exact feature names+shapes so a name/shape drift
            // is visible before run mode rather than as a predict failure.
            for (nm, fd) in desc.inputDescriptionsByName.sorted(by: { $0.key < $1.key }) {
                let sh = fd.multiArrayConstraint?.shape.map { $0.intValue } ?? []
                eprint("  IN  \(nm) \(sh) \(fd.multiArrayConstraint?.dataType.rawValue ?? -1)")
            }
            for (nm, fd) in desc.outputDescriptionsByName.sorted(by: { $0.key < $1.key }) {
                let sh = fd.multiArrayConstraint?.shape.map { $0.intValue } ?? []
                eprint("  OUT \(nm) \(sh)")
            }
            results.append(["package": n, "load_ms": ms,
                            "rss_delta_bytes": rss1 &- rss0,
                            "rss_after_bytes": rss1,
                            "input_names": desc.inputDescriptionsByName.keys.sorted(),
                            "output_names": desc.outputDescriptionsByName.keys.sorted(),
                            "inputs": nin, "outputs": nout, "ok": true])
        } catch {
            eprint("LOAD_FAIL \(n): \(error)")
            results.append(["package": n, "ok": false, "error": "\(error)"])
        }
    }
    // warm reload on the head (smallest)
    let p0 = pkgPath(allPackages[0])
    if let (_, ms) = try? loadModel(p0) {
        eprint(String(format: "WARM_RELOAD %@ %.1fms", allPackages[0] as NSString, ms))
    }
    print(String(data: try! JSONSerialization.data(
        withJSONObject: results, options: [.prettyPrinted]), encoding: .utf8)!)

case "residency":
    // CLEAN S1-only decode resident set: exactly 3xS1 segments + head.
    // No S16 model may be constructed in this process — this is the corrected
    // four-model footprint the prior Mode-B 29.5GB number could not prove.
    let decodeSet = [
        "segment_0_s1_ctx512_kvio", "segment_1_s1_ctx512_kvio",
        "segment_2_s1_ctx512_kvio", "final_head_s1_2p6b",
    ]
    var held: [MLModel] = []
    var rows: [[String: Any]] = []
    let base = memStats()
    eprint("RESIDENCY base \(base.desc)")
    var failed = false
    for n in decodeSet {
        let before = memStats()
        do {
            let (m, ms) = try loadModel(pkgPath(n))
            held.append(m)
            let after = memStats()
            let deltaMB = (Int64(after.physFootprintMB) - Int64(before.physFootprintMB))
            eprint(String(format: "RESIDENT_LOAD %-40@ %8.1fms  before[rss=%lldMB] after[%@] delta=%lldMB",
                          n as NSString, ms, Int64(before.physFootprintMB), after.desc, deltaMB))
            rows.append(["package": n, "load_ms": ms, "ok": true,
                         "footprint_before_mb": before.physFootprintMB,
                         "footprint_after_mb": after.physFootprintMB,
                         "delta_mb": after.physFootprintMB - before.physFootprintMB,
                         "compressed_mb": after.compressedMB,
                         "mem_free_pct": after.memFreePct,
                         "swap_used_mb": after.swapUsedMB,
                         "swap_total_mb": after.swapTotalMB])
        } catch {
            eprint("RESIDENT_FAIL \(n): \(error)")
            rows.append(["package": n, "ok": false, "error": "\(error)"])
            failed = true
        }
    }
    let fin = memStats()
    eprint("RESIDENCY final \(fin.desc) held=\(held.count)")
    print(String(data: try! JSONSerialization.data(withJSONObject: [
        "compute_units": args.cu,
        "base": ["footprint_mb": base.physFootprintMB, "mem_free_pct": base.memFreePct,
                 "compressed_mb": base.compressedMB, "swap_used_mb": base.swapUsedMB],
        "final": ["footprint_mb": fin.physFootprintMB, "mem_free_pct": fin.memFreePct,
                  "compressed_mb": fin.compressedMB, "swap_used_mb": fin.swapUsedMB,
                  "swap_total_mb": fin.swapTotalMB],
        "final_footprint_mb": fin.physFootprintMB,
        "four_model_delta_mb": fin.physFootprintMB - base.physFootprintMB,
        "held": held.count, "all_loaded": !failed, "rows": rows,
    ], options: [.prettyPrinted]), encoding: .utf8)!)

case "run", "probe":
    let fx = loadFixture()
    let (emb, segs, head) = makeAdapters()
    if args.mode == "probe" {
        args.steps = 1
        head.probeIDs = args.probeIds.split(separator: ",").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
        eprint("PROBE probe_ids=\(head.probeIDs)")
    }
    let prefillWindow = (args.parity == "b") ? 16 : 1
    let cfg = StepperConfig(schedule: schedule, geometry: geometry, partition: partition,
                            embedding: emb, segments: segs, head: head,
                            prefillWindow: prefillWindow,
                            decodeContract: .strictSingleToken)
    let stepper = try! CausalStepper(config: cfg)
    stepper.reset()

    let prompt = fx.prompt_ids.map { TokenID($0) }
    eprint("RUN mode=\(args.parity) prefillWindow=\(prefillWindow) prompt=\(prompt.count) maxNew=\(args.steps)")

    let tStart = TimingLog.nowNs()
    let result: GenerationResult
    do {
        result = try stepper.generate(prompt: prompt, maxNew: args.steps)
    } catch {
        eprint("GENERATE_FAIL: \(error)")
        exit(3)
    }
    let wallNs = TimingLog.nowNs() - tStart

    let produced = result.generated.map { Int($0.value) }
    let expect = fx.hf_tokens
    var firstDiff = -1
    for i in 0..<min(produced.count, expect.count) where produced[i] != expect[i] {
        firstDiff = i; break
    }
    let nExact = zip(produced, expect).filter { $0 == $1 }.count

    let report = ContractAuditor.audit(trace: stepper.trace, partition: partition, schedule: schedule)

    eprint("GENERATED \(produced)")
    eprint("EXPECTED  \(expect)")
    eprint("PARITY exact=\(nExact)/\(min(produced.count, expect.count)) firstDiff=\(firstDiff)")
    eprint("AUDIT \(report.passed ? "ALL_PASS" : "VIOLATIONS")")
    if !report.passed { eprint("\(report)") }
    eprint("TIMING\n\(timing.summary())")

    // Prefill/decode split: head call 0 ends at first-token boundary;
    // calls 1..N-1 are the strict-S1 decode steps.
    let headCalls = timing.stages["head"]?.calls ?? []
    let ttftNs = headCalls.first.map { $0.endNs - tStart } ?? 0
    let decodeNs = headCalls.count > 1
        ? headCalls.last!.endNs - headCalls.first!.endNs : 0
    let decodeTokens = max(0, produced.count - 1)
    let decodeTokS = decodeNs > 0 ? Double(decodeTokens) / (Double(decodeNs) / 1e9) : 0

    var out: [String: Any] = [
        "mode": args.parity, "steps": produced.count,
        "parity_exact": nExact, "parity_first_diff": firstDiff,
        "audit_passed": report.passed,
        "wall_s": Double(wallNs) / 1e9,
        "ttft_s": Double(ttftNs) / 1e9,
        "decode_wall_s": Double(decodeNs) / 1e9,
        "decode_tokens": decodeTokens,
        "decode_tok_per_s": decodeTokS,
        "rss_bytes": processFootprint(),
        "generated": produced, "expected": expect,
    ]
    var st: [String: Any] = [:]
    for (k, r) in timing.stages {
        let sorted = r.perCall.sorted()
        guard !sorted.isEmpty else { continue }
        st[k] = ["n": r.count, "total_ms": Double(r.totalNs) / 1e6,
                 "p50_ms": sorted[sorted.count / 2],
                 "p95_ms": sorted[Int(Double(sorted.count - 1) * 0.95)],
                 "p99_ms": sorted[Int(Double(sorted.count - 1) * 0.99)]]
    }
    out["per_stage"] = st
    print(String(data: try! JSONSerialization.data(
        withJSONObject: out, options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
    // Parity/audit failure is a run-level FAIL the seat can see.
    if firstDiff != -1 || !report.passed { exit(5) }

case "score":
    // Batch semantic probe: --fixture <noul-ids.jsonl>, --probe-ids <csv>.
    // Each row carries prompt_ids pre-padded to a multiple of 16 real tokens
    // so ONLY the S16 packages + head are ever touched (s1 adapters are
    // constructed lazily and never load). head emits one PROBE_JSON per row
    // at the last prompt position. SCORE_BEGIN/END rows carry the binding
    // fields so the consumer can join probabilities to request/candidate.
    let (emb, segs, head) = makeAdapters()
    head.probeIDs = args.probeIds.split(separator: ",").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
    guard !head.probeIDs.isEmpty else { eprint("score: --probe-ids required"); exit(2) }
    let cfg = StepperConfig(schedule: schedule, geometry: geometry, partition: partition,
                            embedding: emb, segments: segs, head: head,
                            prefillWindow: 16,
                            decodeContract: .strictSingleToken)
    let stepper = try! CausalStepper(config: cfg)
    let idsURL = URL(fileURLWithPath: args.fixture)
    let idsText = try! String(contentsOf: idsURL, encoding: .utf8)
    var rowIndex = 0
    var scored = 0
    for rawLine in idsText.split(separator: "\n") {
        let line = rawLine.trimmingCharacters(in: .whitespaces)
        if line.isEmpty { continue }
        guard let obj = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
              let idsAny = obj["prompt_ids"] as? [Any] else {
            eprint("SCORE_SKIP row=\(rowIndex) unparsable"); rowIndex += 1; continue
        }
        let ids = idsAny.compactMap { ($0 as? NSNumber)?.intValue }
        if ids.isEmpty || ids.count % 16 != 0 {
            eprint("SCORE_SKIP row=\(rowIndex) prompt_ids not 16-aligned (\(ids.count))")
            rowIndex += 1; continue
        }
        // Multi-position probes: manifest may carry probes:[{axis,offset}]
        // where offset is a global prompt position; the last 16-window holds
        // every probed slot (slot = offset % 16 when len % 16 == 0).
        if let probes = obj["probes"] as? [[String: Any]], !probes.isEmpty {
            let lastWin = ids.count - 16
            var offs: [Int] = []
            var ok = true
            for p in probes {
                guard let go = (p["offset"] as? NSNumber)?.intValue,
                      go >= lastWin, go < ids.count else { ok = false; break }
                offs.append(go - lastWin)
            }
            if !ok {
                eprint("SCORE_SKIP row=\(rowIndex) probe offsets outside last window")
                rowIndex += 1; continue
            }
            head.probeOffsets = offs
        } else {
            head.probeOffsets = []
        }
        stepper.reset()
        let key: [String: Any] = [
            "row": rowIndex,
            "requestId": obj["requestId"] as? String ?? "",
            "candidateId": obj["candidateId"] as? String ?? "",
            "axis": obj["axis"] as? String ?? "",
            "candidateViewDigest": obj["candidateViewDigest"] as? String ?? "",
            "promptDigest": obj["promptDigest"] as? String ?? "",
            "promptTokens": ids.count,
            "probes": obj["probes"] as? [[String: Any]] ?? [],
        ]
        FileHandle.standardOutput.write(("SCORE_BEGIN " + String(data: try! JSONSerialization.data(withJSONObject: key), encoding: .utf8)! + "\n").data(using: .utf8)!)
        let t0 = TimingLog.nowNs()
        do {
            _ = try stepper.generate(prompt: ids.map { TokenID($0) }, maxNew: 0)
        } catch {
            eprint("SCORE_FAIL row=\(rowIndex): \(error)")
            rowIndex += 1; continue
        }
        let ms = Double(TimingLog.nowNs() - t0) / 1e6
        FileHandle.standardOutput.write(("SCORE_END " + String(data: try! JSONSerialization.data(withJSONObject: [
            "row": rowIndex, "ms": ms, "rss_bytes": processFootprint(),
        ]), encoding: .utf8)! + "\n").data(using: .utf8)!)
        scored += 1
        rowIndex += 1
    }
    eprint("SCORE_DONE scored=\(scored) skipped=\(rowIndex - scored)")
    eprint("TIMING\n\(timing.summary())")

case "mat":
    // First-evaluation materialization probe. Separates MLModel-load footprint
    // from first/warm-eval materialization. --only seg0|seg1|seg2|head runs one
    // model in a clean process (baseline -> load -> eval1 -> eval2); --only set
    // loads the 4-model decode set then runs ONE causal token with footprint
    // after each stage. No tok/s benchmark is manufactured under paging.
    let emb = try! CoreMLEmbeddingAdapter(weightBinPath: args.embed, timing: timing)
    func decWin(_ pos: Int) -> StepWindow {
        StepWindow(phase: .decode,
                   slots: [Slot(.real(position: pos, token: TokenRef(value: 6, source: .prompt(index: 0))))],
                   chainID: pos)
    }
    let hEmb = HiddenState(uid: 0, data: emb.embed(tokens: [6], window: decWin(0)), origin: .embedded)

    func runSeg(_ i: Int) {
        eprint("MAT seg\(i) baseline \(memStats().desc)")
        let b0 = memStats()
        let m = try! loadMLModelHeartbeated(path: pkgPath("segment_\(i)_s1_ctx512_kvio"),
                                            stage: "load", timing: nil)
        let a0 = memStats()
        eprint("MAT seg\(i) after_load delta=\(Int(a0.physFootprintMB - b0.physFootprintMB))MB \(a0.desc)")
        let seg = partition.orderedSegments[i]
        let ad = CoreMLSegmentAdapter(segment: seg, layers: partition.layersBySegment[seg]!,
            s1Path: pkgPath("segment_\(i)_s1_ctx512_kvio"), s16Path: nil,
            schedule: schedule, geometry: geometry, timing: timing)
        ad.preloadLoaded(m, width: 1)
        let st = ad.freshState(serial: i)
        _ = ad.evaluate(hidden: hEmb, window: decWin(0), state: st)
        let a1 = memStats()
        eprint("MAT seg\(i) after_eval1 delta=\(Int(a1.physFootprintMB - a0.physFootprintMB))MB \(a1.desc)")
        _ = ad.evaluate(hidden: hEmb, window: decWin(1), state: st)
        let a2 = memStats()
        eprint("MAT seg\(i) after_eval2 delta=\(Int(a2.physFootprintMB - a1.physFootprintMB))MB \(a2.desc)")
        print(String(data: try! JSONSerialization.data(withJSONObject: [
            "model": "seg\(i)", "compute_units": args.cu,
            "load_mb": a0.physFootprintMB - b0.physFootprintMB,
            "eval1_mb": a1.physFootprintMB - a0.physFootprintMB,
            "eval2_mb": a2.physFootprintMB - a1.physFootprintMB,
            "final_mb": a2.physFootprintMB,
            "load_swap_mb": a0.swapUsedMB - b0.swapUsedMB,
            "eval_swap_mb": a2.swapUsedMB - a0.swapUsedMB,
        ], options: [.prettyPrinted]), encoding: .utf8)!)
    }
    func runHead() {
        eprint("MAT head baseline \(memStats().desc)")
        let b0 = memStats()
        let m = try! loadMLModelHeartbeated(path: pkgPath("final_head_s1_2p6b"), stage: "load", timing: nil)
        let a0 = memStats()
        eprint("MAT head after_load delta=\(Int(a0.physFootprintMB - b0.physFootprintMB))MB \(a0.desc)")
        let head = CoreMLHeadAdapter(path: pkgPath("final_head_s1_2p6b"), timing: timing)
        head.preloadLoaded(m)
        _ = head.nextToken(hidden: hEmb, realSlotOffset: 0, window: decWin(0))
        let a1 = memStats()
        eprint("MAT head after_eval1 delta=\(Int(a1.physFootprintMB - a0.physFootprintMB))MB \(a1.desc)")
        _ = head.nextToken(hidden: hEmb, realSlotOffset: 0, window: decWin(1))
        let a2 = memStats()
        eprint("MAT head after_eval2 delta=\(Int(a2.physFootprintMB - a1.physFootprintMB))MB \(a2.desc)")
        print(String(data: try! JSONSerialization.data(withJSONObject: [
            "model": "head", "compute_units": args.cu,
            "load_mb": a0.physFootprintMB - b0.physFootprintMB,
            "eval1_mb": a1.physFootprintMB - a0.physFootprintMB,
            "eval2_mb": a2.physFootprintMB - a1.physFootprintMB,
            "final_mb": a2.physFootprintMB,
        ], options: [.prettyPrinted]), encoding: .utf8)!)
    }

    switch args.only {
    case "seg0", "segment_0_s1_ctx512_kvio": runSeg(0)
    case "seg1", "segment_1_s1_ctx512_kvio": runSeg(1)
    case "seg2", "segment_2_s1_ctx512_kvio": runSeg(2)
    case "head", "final_head_s1_2p6b":      runHead()
    default: // "set": 4-model decode set + one causal token
        eprint("MAT set base \(memStats().desc)")
        var adapters: [CoreMLSegmentAdapter] = []
        var states: [SegmentState] = []
        for i in 0..<3 {
            let b = memStats()
            let m = try! loadMLModelHeartbeated(path: pkgPath("segment_\(i)_s1_ctx512_kvio"),
                                                stage: "load", timing: nil)
            let a = memStats()
            let seg = partition.orderedSegments[i]
            let ad = CoreMLSegmentAdapter(segment: seg, layers: partition.layersBySegment[seg]!,
                s1Path: pkgPath("segment_\(i)_s1_ctx512_kvio"), s16Path: nil,
                schedule: schedule, geometry: geometry, timing: timing)
            ad.preloadLoaded(m, width: 1)
            adapters.append(ad); states.append(ad.freshState(serial: i))
            eprint("MAT set load seg\(i) +\(Int(a.physFootprintMB - b.physFootprintMB))MB \(a.desc)")
        }
        let hb = memStats()
        let hm = try! loadMLModelHeartbeated(path: pkgPath("final_head_s1_2p6b"), stage: "load", timing: nil)
        let ha = memStats()
        let head = CoreMLHeadAdapter(path: pkgPath("final_head_s1_2p6b"), timing: timing)
        head.preloadLoaded(hm)
        eprint("MAT set load head +\(Int(ha.physFootprintMB - hb.physFootprintMB))MB \(ha.desc)")
        eprint("MAT set all_loaded \(memStats().desc)")
        // one causal token: embed -> seg0 -> seg1 -> seg2 -> head
        var h = hEmb
        for i in 0..<3 {
            h = HiddenState(uid: i + 1, data: adapters[i].evaluate(hidden: h, window: decWin(0), state: states[i]), origin: .embedded)
            eprint("MAT set after seg\(i) \(memStats().desc)")
        }
        _ = head.nextToken(hidden: h, realSlotOffset: 0, window: decWin(0))
        eprint("MAT set after head \(memStats().desc)")
        print(String(data: try! JSONSerialization.data(withJSONObject: [
            "model": "set", "compute_units": args.cu, "final": memStats().desc,
        ], options: [.prettyPrinted]), encoding: .utf8)!)
    }

case "teacher":
    // Teacher-forced numerical validation: feed HF-expected tokens during
    // decode so a fragile pos-0 flip cannot poison later context. Head records
    // per-position argmax/rank/margin/vecerr vs the oracle. S1-only adapters.
    let fx = loadFixture()
    let (emb, segs, head) = makeAdapters(withS16: false)
    head.expectedTokens = fx.hf_tokens
    let cfg = StepperConfig(schedule: schedule, geometry: geometry, partition: partition,
                            embedding: emb, segments: segs, head: head,
                            prefillWindow: 1, decodeContract: .strictSingleToken)
    let stepper = try! CausalStepper(config: cfg)
    stepper.reset()
    let prompt = fx.prompt_ids.map { TokenID($0) }
    let forced = fx.hf_tokens.map { TokenID($0) }
    eprint("TEACHER prompt=\(prompt.count) positions=\(min(args.steps, forced.count)) cu=\(args.cu)")
    let tStart = TimingLog.nowNs()
    let result = try! stepper.generate(prompt: prompt, maxNew: min(args.steps, forced.count), forced: forced)
    let wallNs = TimingLog.nowNs() - tStart
    let produced = result.generated.map { Int($0.value) }
    let report = ContractAuditor.audit(trace: stepper.trace, partition: partition, schedule: schedule)
    // classification summary from the head's per-position probe log
    var nExact = 0, nNear = 0, nHigh = 0, nRefTie = 0, firstMat = -1
    for rec in head.probeLog {
        switch rec["class"] as? String {
        case "EXACT": nExact += 1
        case "NEAR_TIE": nNear += 1
        case "REFERENCE_EXACT_TIE": nRefTie += 1
        default:
            nHigh += 1
            if firstMat == -1 { firstMat = rec["k"] as? Int ?? -1 }
        }
    }
    for rec in head.probeLog {
        eprint("TEACHER_POS \(rec)")
    }
    eprint("TEACHER_SUMMARY exact=\(nExact) near_tie=\(nNear) ref_tie=\(nRefTie) high_margin_mismatch=\(nHigh) first_material=\(firstMat)")
    eprint("GENERATED \(produced)")
    eprint("EXPECTED  \(fx.hf_tokens)")
    eprint("AUDIT \(report.passed ? "ALL_PASS" : "VIOLATIONS")")
    if !report.passed { eprint("\(report)") }
    eprint("TIMING\n\(timing.summary())")
    var out: [String: Any] = [
        "positions": head.probeLog, "exact": nExact, "near_tie": nNear,
        "ref_tie": nRefTie, "high_margin_mismatch": nHigh, "first_material": firstMat,
        "audit_passed": report.passed, "wall_s": Double(wallNs) / 1e9,
        "compute_units": args.cu, "generated": produced, "expected": fx.hf_tokens,
        "rss_bytes": processFootprint(),
    ]
    out["mem"] = memStats().desc
    print(String(data: try! JSONSerialization.data(
        withJSONObject: out, options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)

case "plan":
    // Placement evidence: dump per-op preferred compute device for each
    // package via MLComputePlan (no inference — plan inspection only).
    // usage: CausalStepperMac plan --packages <dir> [--compute-units all|cne|cpu]
    func devName(_ d: MLComputeDevice) -> String {
        switch d {
        case .cpu: return "cpu"
        case .gpu: return "gpu"
        case .neuralEngine: return "neuralEngine"
        @unknown default: return "unknown"
        }
    }
    let pkgs = [
        "segment_0_s16_ctx512_kvio_prefill",
        "segment_1_s16_ctx512_kvio_prefill",
        "segment_2_s16_ctx512_kvio_prefill",
        "final_head_s1_2p6b",
        "segment_0_s1_ctx512_kvio",
        "segment_1_s1_ctx512_kvio",
        "segment_2_s1_ctx512_kvio",
    ]
    let sem = DispatchSemaphore(value: 0)
    Task {
        for name in pkgs {
            let url = URL(fileURLWithPath: pkgPath(name))
            let cfg = MLModelConfiguration()
            cfg.computeUnits = gComputeUnits
            do {
                guard #available(macOS 14.4, *) else {
                    eprint("PLAN_FAIL \(name): MLComputePlan requires macOS 14.4")
                    continue
                }
                let plan = try await MLComputePlan.load(contentsOf: url, configuration: cfg)
                var counts: [String: Int] = [:]
                var total = 0
                if case .program(let prog) = plan.modelStructure {
                    for (_, fn) in prog.functions {
                        var stack = fn.block.operations
                        while let op = stack.popLast() {
                            total += 1
                            for b in op.blocks { stack.append(contentsOf: b.operations) }
                            if let du = plan.deviceUsage(for: op) {
                                let k = devName(du.preferred)
                                counts[k] = (counts[k] ?? 0) + 1
                            } else {
                                counts["unknown"] = (counts["unknown"] ?? 0) + 1
                            }
                        }
                    }
                } else {
                    counts["non-program-model"] = 1
                }
                let obj: [String: Any] = [
                    "package": name, "ops": total,
                    "computeUnits": args.cu,
                    "preferredDevice": counts,
                ]
                FileHandle.standardOutput.write(
                    ("PLAN_JSON " + String(data: try! JSONSerialization.data(
                        withJSONObject: obj), encoding: .utf8)! + "\n").data(using: .utf8)!)
            } catch {
                eprint("PLAN_FAIL \(name): \(error)")
            }
        }
        sem.signal()
    }
    sem.wait()
    exit(0)

default:
    eprint("unknown mode \(args.mode)")
    exit(2)
}

#else
fputs("CausalStepperMac requires macOS/CoreML — this host is unsupported\n", stderr)
exit(2)
#endif
