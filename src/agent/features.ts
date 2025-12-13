import { Ai } from "@cloudflare/workers-types";

export async function generateTexture(ai: any, prompt: string): Promise<ReadableStream> {
    const response = await ai.run("@cf/black-forest-labs/flux-1-schnell", {
        prompt: "seamless texture, " + prompt,
        num_steps: 4, // Schnell is fast
    });
    return response; // Flux returns a ReadableStream (image) directly or base64? Usually binary stream.
}

export async function transcribeAudio(ai: any, audioBuffer: ArrayBuffer): Promise<string> {
    const response = await ai.run("@cf/openai/whisper", {
        audio: [...new Uint8Array(audioBuffer)],
    });
    return response.text;
}
