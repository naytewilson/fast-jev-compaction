// Diagnostics.swift — platform-neutral diagnostic helpers.
//
// These helpers are intentionally free of Core ML dependencies so the
// ranking logic used by macOS diagnostic probes is regression-testable in
// the portable CausalStepperCore target.

public struct RankedLogit: Equatable {
    public let id: Int
    public let logit: Float

    public init(id: Int, logit: Float) {
        self.id = id
        self.logit = logit
    }
}

/// Return the highest-k logits in descending logit order.
///
/// Ties are ordered by ascending token id for deterministic receipts.
/// k <= 0 returns an empty result; k > logits.count is clamped.
public func topKLogits(_ logits: [Float], k: Int) -> [RankedLogit] {
    guard k > 0, !logits.isEmpty else { return [] }
    let limit = min(k, logits.count)
    var ranked: [RankedLogit] = []
    ranked.reserveCapacity(limit)

    func comesBefore(_ lhs: RankedLogit, _ rhs: RankedLogit) -> Bool {
        if lhs.logit == rhs.logit { return lhs.id < rhs.id }
        return lhs.logit > rhs.logit
    }

    for (id, logit) in logits.enumerated() {
        let candidate = RankedLogit(id: id, logit: logit)
        if ranked.count < limit {
            ranked.append(candidate)
            ranked.sort(by: comesBefore)
            continue
        }
        guard let tail = ranked.last, comesBefore(candidate, tail) else { continue }
        ranked[ranked.count - 1] = candidate
        ranked.sort(by: comesBefore)
    }
    return ranked
}
