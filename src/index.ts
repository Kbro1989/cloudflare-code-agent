export interface Env {
    MY_KV: KVNamespace;
    AI: any;
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

        const api = await import("./api.ts");

        if (url.pathname === "/api/workspace") {
            return api.handleWorkspaceRequest(request, env);
        }

        if (request.method === "POST" && url.pathname === "/agent/run") {
            return api.handleRequest(request, env);
        }

        return new Response("Not Found", { status: 404 });
    }
};
