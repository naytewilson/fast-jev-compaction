// swift-tools-version:5.9
// CausalStepper — platform-neutral causal state-machine contract for the
// LFM2.5-2.6B 3x10 production engine. Orchestration semantics only: this
// package contains NO Core ML dependency and proves nothing about Apple
// runtime correctness. The macOS/CoreML adapter boundary is explicit.
import PackageDescription

let package = Package(
    name: "CausalStepper",
    // macOS floor for the CoreML adapter target; Linux ignores this.
    platforms: [.macOS(.v14)],
    targets: [
        // Core contract: identity types, layer-sealed recurrent state,
        // partition law, stepper, execution trace, contract auditor.
        .target(
            name: "CausalStepperCore",
            path: "Sources/CausalStepperCore"
        ),
        // Deterministic mock adapters + faithful reconstructions of the
        // historical Route-G chain defects (sabotage mutants).
        .target(
            name: "CausalStepperMocks",
            dependencies: ["CausalStepperCore"],
            path: "Sources/CausalStepperMocks"
        ),
        // Assert-style test runner (repo convention: no XCTest dependency).
        // Run: swift run -c release CausalStepperTests
        .executableTarget(
            name: "CausalStepperTests",
            dependencies: ["CausalStepperCore", "CausalStepperMocks"],
            path: "Sources/CausalStepperTests"
        ),
        // macOS/CoreML production driver — all sources are
        // #if canImport(CoreML)-gated so this target builds to a stub
        // on Linux. Real work: swift run -c release CausalStepperMac.
        .executableTarget(
            name: "CausalStepperMac",
            dependencies: ["CausalStepperCore"],
            path: "Sources/CausalStepperMac"
        ),
    ]
)
