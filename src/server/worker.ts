import { Env } from "../index";

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        if (request.method === "GET" && url.pathname === "/") {
            const { html } = await import("../ui");
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
            const id = env.SESSION_DO.idFromName(sessionId);
            const stub = env.SESSION_DO.get(id);
            return stub.fetch(request);
        }

        return new Response("Not Found", { status: 404 });
    }
};
