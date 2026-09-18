// Trace.swift — the execution record the ContractAuditor adjudicates.
//
// Every orchestration-relevant event is recorded with identities (uids,
// content hashes, provenance), never prose. A claim without a matching
// evidence event is a defect class of its own (the vacuous stateprobe bug).

/// One orchestration event.
public enum TraceEvent {
    /// Fresh state constructed for a segment at an epoch boundary.
    /// initHashes: key -> contentHash at birth.
    case stateInit(epoch: Int, segment: SegmentID, stateSerial: Int,
                   initHashes: [(key: RecurrentStateKey, hash: UInt64)])

    /// Embedding dispatch. slots recorded with provenance.
    case embed(chainID: Int, phase: Phase,
               slots: [(offset: Int, occupancy: Slot.Occupancy)],
               outputUID: Int)

    /// One segment evaluation inside a chain.
    case segmentEval(chainID: Int, segment: SegmentID, phase: Phase,
                     inputUID: Int, inputOrigin: HiddenState.Origin,
                     outputUID: Int,
                     stateSerial: Int,
                     reads: [(key: RecurrentStateKey, hash: UInt64)],
                     writes: [(key: RecurrentStateKey, hash: UInt64)],
                     sealViolations: [String])

    /// Head produced a token.
    case head(chainID: Int, phase: Phase, inputUID: Int,
              realSlotOffset: Int, produced: TokenRef)

    /// A claim made by a harness (e.g. "stateprobe PASS"). Every claim must
    /// be backed by a `stateEvidence` event carrying the same claimID,
    /// else it is vacuous by construction.
    case claim(id: String, text: String)
    case stateEvidence(claimID: String, key: RecurrentStateKey,
                       expectedHash: UInt64, actualHash: UInt64)

    /// Cross-segment state transfer attempt (always a violation if real).
    case stateCopied(from: SegmentID, to: SegmentID, keys: [RecurrentStateKey])
}

public final class ExecutionTrace {
    public private(set) var events: [TraceEvent] = []
    public init() {}
    public func record(_ e: TraceEvent) { events.append(e) }

    public var segmentEvals: [TraceEvent] {
        events.filter { if case .segmentEval = $0 { return true }; return false }
    }
}
