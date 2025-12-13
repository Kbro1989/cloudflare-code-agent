// Model router
// v1: hardcoded qwen2.5-7b. Future: intent-based model selection.

export const MODELS = {
    CHAT: "@cf/meta/llama-3.1-8b-instruct",
    TEXTURE: "@cf/black-forest-labs/flux-1-schnell",
    VOICE: "@cf/openai/whisper",
    VISION: "@cf/uform/uform-gen2-qwen-500m"
};

export function selectModel(intent: string): string {
    return MODELS.CHAT;
}
