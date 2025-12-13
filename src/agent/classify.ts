// Intent classifier (heuristic + cached)
// This is a stub for future multi-intent support.

export type Intent = "design" | "implement" | "debug" | "review" | "optimize" | "explain";

export function classifyIntent(input: string): Intent {
    if (input.match(/error|exception|stack|ts\d+/i)) return "debug";
    if (input.match(/refactor|improve|optimi/i)) return "optimize";
    if (input.match(/review|critique/i)) return "review";
    if (input.match(/design|architecture/i)) return "design";
    return "implement";
}
