export interface Env {
    MY_KV: KVNamespace;
    AI: any;
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        if (request.method !== "POST" || new URL(request.url).pathname !== "/agent/run") {
            return new Response("Not Found", { status: 404 });
        }

        const api = await import("./api.ts");
        return api.handleRequest(request, env);
    }
};
