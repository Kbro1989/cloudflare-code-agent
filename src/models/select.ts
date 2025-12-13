// Model router
// v1: hardcoded qwen2.5-7b. Future: intent-based model selection.

export function selectModel(intent: string): string {
    // TODO: route by intent
    // - "design" / "review" → larger model (e.g., llama-3.1-70b)
    // - "implement" / "debug" → default (qwen2.5-7b)
    return "@cf/meta/llama-3.1-8b-instruct";
}
