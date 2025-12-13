import { Env } from "./index.ts";
import { executeTask } from "./agent/execute.ts";

export async function handleRequest(request: Request, env: Env): Promise<Response> {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
    }

    const { sessionId, input, files } = body as any;
    if (!sessionId || !input || !files || typeof files !== "object") {
        return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
    }

    // 1. Load Session History
    const historyKey = `session:${sessionId}`;
    const history: any[] = await env.MY_KV.get(historyKey, { type: "json" }) || [];

    // 2. Infer Intent (simple heuristic)
    const intent = inferIntent(input);

    // 3. Execute Task
    // We pass the history to the agent so it has context
    const result = await executeTask({
        ai: env.AI,
        model: (body as any).model || "@cf/meta/llama-3.1-8b-instruct",
        input,
        files,
        intent,
        history,
        sessionId
    });

    // 4. Update History (optimistic)
    if (!result.error) {
        history.push({ role: "user", content: input });
        // For now, we store the artifact or text response in history
        const responseContent = result.artifact || result.response || "Task completed.";
        history.push({ role: "assistant", content: responseContent });

        // Cap history to last 10 turns to save KV space
        if (history.length > 20) history.splice(0, history.length - 20);

        await env.MY_KV.put(historyKey, JSON.stringify(history), { expirationTtl: 86400 }); // 24h retention
    }

    return new Response(JSON.stringify(result), {
        status: 200, // Always 200, errors are in body
        headers: { "Content-Type": "application/json" }
    });
}

// Handler for /api/workspace
export async function handleWorkspaceRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");

    if (!sessionId) {
        return new Response(JSON.stringify({ error: "Missing sessionId" }), { status: 400 });
    }

    const key = `workspace:${sessionId}`;

    if (request.method === "GET") {
        const files = await env.MY_KV.get(key, { type: "json" });
        return new Response(JSON.stringify({ files: files || null }), {
            headers: { "Content-Type": "application/json" }
        });
    }

    if (request.method === "POST") {
        const body = await request.json().catch(() => null) as any;
        if (!body || !body.files) {
            return new Response(JSON.stringify({ error: "Missing files" }), { status: 400 });
        }
        await env.MY_KV.put(key, JSON.stringify(body.files));
        return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" }
        });
    }

    return new Response("Method not allowed", { status: 405 });
}


function inferIntent(input: string): string {
    if (input.match(/explain|what does|how does|analysis/i)) return "explain";
    if (input.match(/review|critique|audit/i)) return "review";
    if (input.match(/error|exception|fix|debug/i)) return "debug";
    if (input.match(/refactor|improve|optimi/i)) return "optimize";
    return "implement";
}
