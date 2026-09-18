// Auditor.swift — mechanical adjudication of the causal contract.
//
// Every check is a pure function of the execution trace. A check that
// cannot fail is not evidence; every check here has a sabotage mutant in
// the regression bank that provably trips it.

public struct Violation: Equatable, CustomStringConvertible {
    public let check: String
    public let detail: String
    public init(_ check: String, _ detail: String) {
        self.check = check
        self.detail = detail
    }
    public var description: String { "\(check): \(detail)" }
}

public struct CheckResult: Equatable, CustomStringConvertible {
    public let id: String
    public let passed: Bool
    public let detail: String
    public init(id: String, passed: Bool, detail: String) {
        self.id = id
        self.passed = passed
        self.detail = detail
    }
    public var description: String { "\(id): \(passed ? "PASS" : "FAIL") \(detail)" }
}

public struct AuditReport: CustomStringConvertible {
    public var checks: [CheckResult]
    public var violations: [Violation]
    public init(checks: [CheckResult], violations: [Violation]) {
        self.checks = checks
        self.violations = violations
    }
    public var passed: Bool { violations.isEmpty && checks.allSatisfy { $0.passed } }
    public var description: String {
        var s = checks.map { $0.description }.joined(separator: "\n")
        if !violations.isEmpty {
            s += "\nVIOLATIONS:\n" + violations.map { "  \($0)" }.joined(separator: "\n")
        }
        return s
    }
}

public enum ContractAuditor {

    /// Full audit of one execution trace against the partition/schedule.
    public static func audit(trace: ExecutionTrace,
                             partition: PartitionMap,
                             schedule: LayerSchedule) -> AuditReport {
        var checks: [CheckResult] = []
        var violations: [Violation] = []

        // ---- index events; epoch = index of the contiguous stateInit group
        // the event follows (reset boundaries restart position/feedback law).
        var inits: [(epoch: Int, segment: SegmentID, serial: Int, hashes: [RecurrentStateKey: UInt64])] = []
        var embeds: [(epoch: Int, chainID: Int, phase: Phase, outputUID: Int,
                      slots: [(offset: Int, occupancy: Slot.Occupancy)])] = []
        var evals: [(chainID: Int, segment: SegmentID, phase: Phase, inUID: Int,
                     inOrigin: HiddenState.Origin, outUID: Int, serial: Int,
                     reads: [(key: RecurrentStateKey, hash: UInt64)],
                     writes: [(key: RecurrentStateKey, hash: UInt64)],
                     seal: [String])] = []
        var heads: [(epoch: Int, chainID: Int, phase: Phase, produced: TokenRef)] = []
        var claims: [(id: String, text: String)] = []
        var evidence: [(claimID: String, key: RecurrentStateKey, expected: UInt64, actual: UInt64)] = []
        var copies: [(from: SegmentID, to: SegmentID, keys: [RecurrentStateKey])] = []

        var epoch = 0
        var prevWasInit = true
        var sawInit = false
        for e in trace.events {
            let isInit: Bool
            if case .stateInit = e { isInit = true; sawInit = true } else { isInit = false }
            if isInit && !prevWasInit { epoch += 1 }
            prevWasInit = isInit
            switch e {
            case .stateInit(_, let seg, let serial, let hashes):
                inits.append((epoch, seg, serial,
                              Dictionary(uniqueKeysWithValues: hashes.map { ($0.key, $0.hash) })))
            case .embed(let cid, let ph, let slots, let out):
                embeds.append((sawInit ? epoch : 0, cid, ph, out, slots))
            case .segmentEval(let cid, let seg, let ph, let iu, let io, let ou,
                             let serial, let r, let w, let seal):
                evals.append((cid, seg, ph, iu, io, ou, serial, r, w, seal))
            case .head(let cid, let ph, _, _, let produced):
                heads.append((sawInit ? epoch : 0, cid, ph, produced))
            case .claim(let id, let text):
                claims.append((id, text))
            case .stateEvidence(let cid, let k, let exp, let act):
                evidence.append((cid, k, exp, act))
            case .stateCopied(let f, let t, let ks):
                copies.append((f, t, ks))
            }
        }

        var embedPhase: [Int: Phase] = [:]
        var embedOut: [Int: Int] = [:]
        for e in embeds { embedPhase[e.chainID] = e.phase; embedOut[e.chainID] = e.outputUID }

        // ---- 1. hiddenChaining: per chain, embed->s1->s2->s3->head ----
        do {
            var bad = 0; var checked = 0
            let evalsByChain = Dictionary(grouping: evals, by: { $0.chainID })
            for (cid, group) in evalsByChain.sorted(by: { $0.key < $1.key }) {
                let ordered = group.sorted { $0.segment.ordinal < $1.segment.ordinal }
                var prevUID = embedOut[cid]
                for (i, ev) in ordered.enumerated() {
                    checked += 1
                    if i == 0 {
                        if ev.inUID != prevUID {
                            bad += 1
                            violations.append(Violation("hiddenChaining",
                                "chain \(cid): \(ev.segment) input uid \(ev.inUID) != embed output \(prevUID ?? -1)"))
                        }
                    } else {
                        let prev = ordered[i - 1]
                        if ev.inUID != prev.outUID {
                            bad += 1
                            violations.append(Violation("hiddenChaining",
                                "chain \(cid): \(ev.segment) input uid \(ev.inUID) != \(prev.segment) output \(prev.outUID)"))
                        }
                    }
                    prevUID = ev.outUID
                }
            }
            checks.append(CheckResult(id: "hiddenChaining", passed: bad == 0 && checked > 0,
                                      detail: "\(checked) segment-boundary handoffs, \(bad) mismatches"))
        }

        // ---- 2. noSyntheticHidden: every segment input must be the output
        // of the embed (first segment) or of the immediately-preceding
        // segment in the SAME chain — anything else is fabricated.
        do {
            var bad = 0
            let evalsByChain = Dictionary(grouping: evals, by: { $0.chainID })
            for (cid, group) in evalsByChain {
                let ordered = group.sorted { $0.segment.ordinal < $1.segment.ordinal }
                var legal = Set<Int>()
                if let e = embedOut[cid] { legal.insert(e) }
                for ev in ordered {
                    if !legal.contains(ev.inUID) {
                        bad += 1
                        violations.append(Violation("noSyntheticHidden",
                            "chain \(cid): \(ev.segment) consumed uid \(ev.inUID) not produced inside this chain (origin \(ev.inOrigin))"))
                    }
                    legal.insert(ev.outUID)
                }
            }
            checks.append(CheckResult(id: "noSyntheticHidden", passed: bad == 0,
                                      detail: "\(bad) foreign hidden inputs"))
        }

        // ---- 3. stateLayerSealing: IO only in-domain; zero seal events ----
        do {
            var bad = 0
            for ev in evals {
                let domain = Set(partition.layersBySegment[ev.segment] ?? [])
                for (k, _) in ev.reads + ev.writes where !domain.contains(k.layer) {
                    bad += 1
                    violations.append(Violation("stateLayerSealing",
                        "\(ev.segment) touched foreign layer \(k.layer) (\(k.kind))"))
                }
                for s in ev.seal {
                    bad += 1
                    violations.append(Violation("stateLayerSealing", "\(ev.segment): \(s)"))
                }
            }
            checks.append(CheckResult(id: "stateLayerSealing", passed: bad == 0,
                                      detail: "\(bad) out-of-domain state touches"))
        }

        // ---- 4. noCrossSegmentCache: no key in two segments' IO; each eval
        // must use the serial installed by the segment's LATEST init (epoch-
        // aware: a reset legitimately installs a new map); zero stateCopied.
        do {
            var bad = 0
            var owner: [RecurrentStateKey: SegmentID] = [:]
            var currentSerial: [SegmentID: Int] = [:]
            for e in trace.events {
                switch e {
                case .stateInit(_, let seg, let serial, _):
                    currentSerial[seg] = serial
                case .segmentEval(let cid, let seg, _, _, _, _, let serial, let r, let w, _):
                    if let cur = currentSerial[seg], cur != serial {
                        bad += 1
                        violations.append(Violation("noCrossSegmentCache",
                            "chain \(cid): \(seg) evaluated against map serial \(serial) but epoch map is \(cur)"))
                    }
                    for (k, _) in r + w {
                        if let o = owner[k], o != seg {
                            bad += 1
                            violations.append(Violation("noCrossSegmentCache",
                                "key \(k) touched by both \(o) and \(seg)"))
                        } else {
                            owner[k] = seg
                        }
                    }
                default: break
                }
            }
            for c in copies {
                bad += 1
                violations.append(Violation("noCrossSegmentCache",
                    "stateCopied \(c.from)->\(c.to) keys \(c.keys)"))
            }
            checks.append(CheckResult(id: "noCrossSegmentCache", passed: bad == 0,
                                      detail: "\(bad) cross-segment state events"))
        }

        // ---- 5. kvIdentityDistinct: per attention layer, K and V appear as
        // separate keys — a layer-only dict collapses them and is caught by
        // check 6's stale-read; this check guards asymmetric collapse.
        do {
            var bad = 0
            let attn = Set(schedule.attentionLayers)
            var seen: [SegmentID: Set<RecurrentStateKey>] = [:]
            for ev in evals {
                for (k, _) in ev.reads + ev.writes { seen[ev.segment, default: []].insert(k) }
            }
            for (seg, keys) in seen {
                for l in attn where (partition.layersBySegment[seg] ?? []).contains(l) {
                    let hasK = keys.contains(RecurrentStateKey(layer: l, kind: .key))
                    let hasV = keys.contains(RecurrentStateKey(layer: l, kind: .value))
                    if hasK != hasV {
                        bad += 1
                        violations.append(Violation("kvIdentityDistinct",
                            "\(seg) layer \(l): K=\(hasK) V=\(hasV) — identities collapsed"))
                    }
                }
            }
            checks.append(CheckResult(id: "kvIdentityDistinct", passed: bad == 0,
                                      detail: "\(bad) K/V identity collapses"))
        }

        // ---- 6. sameLayerStateFeedback: walk the stream in order; a
        // stateInit re-baselines the segment's expected hashes (epoch
        // boundary). Each read must equal the same segment's last write
        // (or its init value if never written this epoch).
        do {
            var bad = 0
            var lastWrite: [SegmentID: [RecurrentStateKey: UInt64]] = [:]
            for e in trace.events {
                switch e {
                case .stateInit(_, let seg, _, let hashes):
                    lastWrite[seg] = Dictionary(uniqueKeysWithValues: hashes.map { ($0.key, $0.hash) })
                case .segmentEval(let cid, let seg, _, _, _, _, _, let r, let w, _):
                    var lw = lastWrite[seg] ?? [:]
                    for (k, h) in r {
                        if let exp = lw[k] {
                            if exp != h {
                                bad += 1
                                violations.append(Violation("sameLayerStateFeedback",
                                    "chain \(cid) \(seg) read \(k) hash \(h) != last written \(exp) — stale/foreign state"))
                            }
                        } else {
                            bad += 1
                            violations.append(Violation("sameLayerStateFeedback",
                                "chain \(cid) \(seg) read \(k) with no prior write/init"))
                        }
                    }
                    for (k, h) in w { lw[k] = h }
                    lastWrite[seg] = lw
                default: break
                }
            }
            checks.append(CheckResult(id: "sameLayerStateFeedback", passed: bad == 0,
                                      detail: "\(bad) stale/foreign state reads"))
        }

        // ---- 7. deterministicFreshInit: init events must form contiguous
        // epoch-boundary groups, each covering every segment exactly once;
        // (seg,key) hashes identical across groups. A lone mid-run init or
        // a partial group is a re-zero/nondeterministic defect.
        do {
            var bad = 0
            var groups: [[(segment: SegmentID, hashes: [RecurrentStateKey: UInt64])]] = [[]]
            var prevWasInit = true   // leading edge counts as a boundary
            for e in trace.events {
                if case .stateInit(_, let seg, _, let hashes) = e {
                    if !prevWasInit { groups.append([]) }
                    groups[groups.count - 1].append((seg,
                        Dictionary(uniqueKeysWithValues: hashes.map { ($0.key, $0.hash) })))
                    prevWasInit = true
                } else {
                    prevWasInit = false
                }
            }
            if groups.last?.isEmpty == true { groups.removeLast() }
            var firstHashes: [SegmentID: [RecurrentStateKey: UInt64]] = [:]
            for (gi, group) in groups.enumerated() {
                var seen = Set<SegmentID>()
                for entry in group {
                    if !seen.insert(entry.segment).inserted {
                        bad += 1
                        violations.append(Violation("deterministicFreshInit",
                            "\(entry.segment) initialized twice in epoch \(gi + 1)"))
                    }
                    if let prev = firstHashes[entry.segment], prev != entry.hashes {
                        bad += 1
                        violations.append(Violation("deterministicFreshInit",
                            "\(entry.segment) epoch \(gi + 1) init differs from epoch 1 — nondeterministic reset"))
                    } else if firstHashes[entry.segment] == nil {
                        firstHashes[entry.segment] = entry.hashes
                    }
                }
                for seg in partition.orderedSegments where !seen.contains(seg) {
                    bad += 1
                    violations.append(Violation("deterministicFreshInit",
                        "\(seg) never initialized in epoch \(gi + 1)"))
                }
            }
            checks.append(CheckResult(id: "deterministicFreshInit", passed: bad == 0 && !inits.isEmpty,
                                      detail: "\(groups.count) epoch(s), \(inits.count) init events, \(bad) anomalies"))
        }

        // ---- 8. positionSingleAdvance: per epoch, real positions are
        // 0..P-1 prefill then P,P+1,... decode — each once, stride +1.
        do {
            var bad = 0; var total = 0
            for ep in Set(embeds.map { $0.epoch }).sorted() {
                var realPos: [Int] = []
                for e in embeds.filter({ $0.epoch == ep }).sorted(by: { $0.chainID < $1.chainID }) {
                    for s in e.slots.sorted(by: { $0.offset < $1.offset }) {
                        if case .real(let p, _) = s.occupancy { realPos.append(p) }
                    }
                }
                total += realPos.count
                var seenPos = Set<Int>()
                var prev: Int? = nil
                for p in realPos {
                    if !seenPos.insert(p).inserted {
                        bad += 1
                        violations.append(Violation("positionSingleAdvance",
                            "epoch \(ep): position \(p) fed twice"))
                    }
                    if let pv = prev, p != pv + 1 {
                        bad += 1
                        violations.append(Violation("positionSingleAdvance",
                            "epoch \(ep): position jumped \(pv)->\(p) (stride \(p - pv))"))
                    }
                    prev = p
                }
            }
            checks.append(CheckResult(id: "positionSingleAdvance", passed: bad == 0 && total > 0,
                                      detail: "\(total) real positions, \(bad) anomalies"))
        }

        // ---- 9. noFinalPromptDoubleFeed: decode-phase real slots must carry
        // .generated provenance only — a .prompt there is the pair_probe bug.
        do {
            var bad = 0
            for e in embeds where e.phase == .decode {
                for s in e.slots {
                    if case .real(_, let t) = s.occupancy, case .prompt = t.source {
                        bad += 1
                        violations.append(Violation("noFinalPromptDoubleFeed",
                            "decode consumed \(t) — prompt token re-fed (pair_probe defect)"))
                    }
                }
            }
            checks.append(CheckResult(id: "noFinalPromptDoubleFeed", passed: bad == 0,
                                      detail: "\(bad) prompt tokens in decode"))
        }

        // ---- 10. generatedTokenFeedback: per epoch, produced token at
        // index j is the real token fed at decode dispatch j.
        do {
            var bad = 0; var fedTotal = 0
            for ep in Set(heads.map { $0.epoch }).sorted() {
                let produced = heads.filter { $0.epoch == ep }
                    .sorted { $0.chainID < $1.chainID }.map { $0.produced }
                var fedGenerated: [TokenRef] = []
                for e in embeds.filter({ $0.epoch == ep }).sorted(by: { $0.chainID < $1.chainID })
                where e.phase == .decode {
                    for s in e.slots.sorted(by: { $0.offset < $1.offset }) {
                        if case .real(_, let t) = s.occupancy, case .generated = t.source {
                            fedGenerated.append(t)
                        }
                    }
                }
                fedTotal += fedGenerated.count
                for (i, f) in fedGenerated.enumerated() where i < produced.count {
                    if f != produced[i] {
                        bad += 1
                        violations.append(Violation("generatedTokenFeedback",
                            "epoch \(ep): decode fed \(f) but produced[\(i)] was \(produced[i])"))
                    }
                }
            }
            checks.append(CheckResult(id: "generatedTokenFeedback", passed: bad == 0,
                                      detail: "\(fedTotal) feedback tokens, \(bad) mismatches"))
        }

        // ---- 11. phaseDiscipline: per epoch, all prefill dispatches
        // precede decode dispatches.
        do {
            var bad = 0
            for ep in Set(embeds.map { $0.epoch }).sorted() {
                var seenDecode = false
                for e in embeds.filter({ $0.epoch == ep }).sorted(by: { $0.chainID < $1.chainID }) {
                    if e.phase == .decode { seenDecode = true }
                    if e.phase == .prefill && seenDecode {
                        bad += 1
                        violations.append(Violation("phaseDiscipline",
                            "epoch \(ep): prefill dispatch after decode at chain \(e.chainID)"))
                    }
                }
            }
            checks.append(CheckResult(id: "phaseDiscipline", passed: bad == 0,
                                      detail: "\(bad) phase order anomalies"))
        }

        // ---- 12. claimsBacked: every claim needs same-claimID evidence —
        // the vacuous stateprobe defect fails closed here.
        do {
            var bad = 0
            for c in claims {
                let evs = evidence.filter { $0.claimID == c.id }
                if evs.isEmpty {
                    bad += 1
                    violations.append(Violation("claimsBacked",
                        "claim '\(c.id)' has zero evidence events — vacuous"))
                }
                for ev in evs where ev.expected != ev.actual {
                    bad += 1
                    violations.append(Violation("claimsBacked",
                        "claim '\(c.id)' evidence \(ev.key): expected \(ev.expected) got \(ev.actual)"))
                }
            }
            checks.append(CheckResult(id: "claimsBacked", passed: bad == 0,
                                      detail: "\(claims.count) claims, \(bad) vacuous/false"))
        }

        // ---- 13. noPaddedDispatch (D1.1): zero .pad occupancies anywhere.
        // Under KVIO every slot writes recurrent K/V and advances conv
        // state — "1 real + 15 pads, ignore pad logits" advances state by
        // sixteen real positions. That is the D1 defect: it dies here.
        do {
            var bad = 0
            for e in embeds {
                let pads = e.slots.filter { $0.occupancy == .pad }
                if !pads.isEmpty {
                    bad += 1
                    violations.append(Violation("noPaddedDispatch",
                        "chain \(e.chainID) \(e.phase): \(pads.count) pad slot(s) — pads write state under KVIO (D1 defect)"))
                }
            }
            checks.append(CheckResult(id: "noPaddedDispatch", passed: bad == 0,
                                      detail: "\(bad) windows containing pad slots"))
        }

        // ---- 14. decodeSingleToken (D1.1): every decode window carries
        // exactly one slot and it is real. A wider decode window is only
        // legal under an explicit multi-token acceptance contract, which
        // this trace format does not yet express — flag it conservatively.
        do {
            var bad = 0; var decodes = 0
            for e in embeds where e.phase == .decode {
                decodes += 1
                let reals = e.slots.filter {
                    if case .real = $0.occupancy { return true }; return false
                }
                if e.slots.count != 1 || reals.count != 1 {
                    bad += 1
                    violations.append(Violation("decodeSingleToken",
                        "chain \(e.chainID): decode window width=\(e.slots.count) reals=\(reals.count) — contract is S=1"))
                }
            }
            checks.append(CheckResult(id: "decodeSingleToken", passed: bad == 0 && decodes > 0,
                                      detail: "\(decodes) decode dispatches, \(bad) width violations"))
        }

        // ---- 15. prefillBlockLaw (D1.1): prefill windows are all-real and
        // either width-1 (prompt tail) or the epoch's modal full-block
        // width. A mid-width window (e.g. 7 reals) has no package.
        do {
            var bad = 0; var checked = 0
            for ep in Set(embeds.map { $0.epoch }).sorted() {
                let pre = embeds.filter { $0.epoch == ep && $0.phase == .prefill }
                    .sorted { $0.chainID < $1.chainID }
                let counts = pre.map {
                    $0.slots.filter { s in
                        if case .real = s.occupancy { return true }; return false
                    }.count
                }
                let modal = counts.max() ?? 0
                for (e, c) in zip(pre, counts) {
                    checked += 1
                    if c != e.slots.count {
                        // pad contamination is check 13's job; here it also
                        // breaks the block law.
                        bad += 1
                        violations.append(Violation("prefillBlockLaw",
                            "chain \(e.chainID): \(c) real of \(e.slots.count) slots — partial-width prefill"))
                    } else if c != 1 && c != modal {
                        bad += 1
                        violations.append(Violation("prefillBlockLaw",
                            "chain \(e.chainID): prefill width \(c) is neither tail(1) nor block(\(modal))"))
                    }
                }
            }
            checks.append(CheckResult(id: "prefillBlockLaw", passed: bad == 0 && checked > 0,
                                      detail: "\(checked) prefill windows, \(bad) width violations"))
        }

        return AuditReport(checks: checks, violations: violations)
    }
}
