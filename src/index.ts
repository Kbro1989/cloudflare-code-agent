export { SessionDO } from "./objects/SessionDO.ts";

export interface Env {
    MY_KV: KVNamespace;
    AI: any;
    SESSION_DO: DurableObjectNamespace;
    WORKSPACE_BUCKET: R2Bucket;
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        if (request.method === "GET" && url.pathname === "/") {
            const { html } = await import("./ui.ts");
            return new Response(html, {
                status: 200,
                headers: { "Content-Type": "text/html" }
            });
        }

        if (url.pathname === "/favicon.ico") {
            return new Response(null, { status: 204 });
        }

        const sessionId = request.headers.get("X-Session-ID") || url.searchParams.get("sessionId");

        if (sessionId && (url.pathname.startsWith("/api") || url.pathname.startsWith("/agent"))) {
            // For WebSocket upgrades or API calls, forward to the SessionDO
            const id = env.SESSION_DO.idFromName(sessionId);
            const stub = env.SESSION_DO.get(id);
            return stub.fetch(request);
        }

        return new Response("Not Found", { status: 404 });
    }
};
