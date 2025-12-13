import { Env } from "./index.ts";
import { executeImplement } from "./agent/execute.ts";

export async function handleRequest(request: Request, env: Env): Promise<Response> {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
    }

    const { sessionId, input, files, options = {} } = body as any;
    if (!sessionId || !input || !files || typeof files !== "object") {
        return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
    }

    // Intent caching (per session)
    const intentKey = `${sessionId}:${hash(input)}:intent`;
    let intent = await env.MY_KV.get(intentKey);
    if (!intent) {
        intent = inferIntent(input);
        await env.MY_KV.put(intentKey, intent, { expirationTtl: 300 });
    }

    // v1: only "implement" intent
    if (intent !== "implement") {
        return new Response(JSON.stringify({ error: "Unsupported intent", intent }), { status: 400 });
    }

    // Execute
    const result = await executeImplement({
        ai: env.AI,
        model: "@cf/meta/llama-3.1-8b-instruct",
        input,
        files,
        plan: ["Apply requested change"],
        sessionId
    });

    return new Response(JSON.stringify(result), {
        status: result.error ? 200 : 200,
        headers: { "Content-Type": "application/json" }
    });
}

function inferIntent(input: string): string {
    if (input.match(/error|exception|stack|ts\d+/i)) return "debug";
    if (input.match(/refactor|improve|optimi/i)) return "optimize";
    if (input.match(/review|critique/i)) return "review";
    if (input.match(/design|architecture/i)) return "design";
    return "implement";
}

function hash(s: string): string {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
        h = (h * 33) ^ s.charCodeAt(i);
    }
    return h.toString(36);
}
