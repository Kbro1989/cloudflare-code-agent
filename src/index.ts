import { KVNamespace } from "@cloudflare/workers-types";

export interface Env {
    MY_KV: KVNamespace;
    AI: any;
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        if (request.method === "GET" && url.pathname === "/") {
            return new Response("Cloudflare Code Agent is active.\n\nPOST JSON to /agent/run to use.\nSee README for details.", {
                status: 200,
                headers: { "Content-Type": "text/plain" }
            });
        }

        if (url.pathname === "/favicon.ico") {
            return new Response(null, { status: 204 });
        }

        if (request.method !== "POST" || url.pathname !== "/agent/run") {
            return new Response("Not Found", { status: 404 });
        }

        const api = await import("./api.ts");
        return api.handleRequest(request, env);
    }
};
