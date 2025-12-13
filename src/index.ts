import { KVNamespace, R2Bucket } from "@cloudflare/workers-types";
import { renderHtml } from "./ui/html.ts";
import { editorScript } from "./ui/scripts.ts";
import { StorageService } from "./services/storage.ts";
import { Env } from "./types.ts";

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        // 1. Editor UI (Root)
        if (request.method === "GET" && url.pathname === "/") {
            return new Response(renderHtml(env), {
                status: 200,
                headers: { "Content-Type": "text/html" }
            });
        }

        // 2. Editor Script (Static Asset)
        if (request.method === "GET" && url.pathname === "/editor.js") {
            return new Response(editorScript, {
                status: 200,
                headers: { "Content-Type": "text/javascript" }
            });
        }

        // 3. Asset Management (R2)
        const storage = new StorageService(env.ASSETS);

        // GET /assets/:key (Serve model/data)
        if (request.method === "GET" && url.pathname.startsWith("/assets/")) {
            const key = url.pathname.slice(8); // Remove /assets/
            const object = await storage.get(key);

            if (object === null) {
                return new Response("Object Not Found", { status: 404 });
            }

            const headers = new Headers();
            object.writeHttpMetadata(headers);
            headers.set("etag", object.httpEtag);

            return new Response(object.body, {
                headers,
            });
        }

        // PUT /assets/:key (Save model/data)
        if (request.method === "PUT" && url.pathname.startsWith("/assets/")) {
            const key = url.pathname.slice(8);
            await storage.upload(key, request.body, request.headers.get("Content-Type") || "application/octet-stream");
            return new Response(`Put ${key} successfully!`);
        }

        // POST /upload (Ingest raw models)
        if (request.method === "POST" && url.pathname === "/upload") {
            const key = url.searchParams.get("key") || `upload-${Date.now()}`;
            await storage.upload(key, request.body, request.headers.get("Content-Type") || "application/octet-stream");
            return new Response(`Uploaded ${key} successfully!`);
        }

        // 4. AI Feature Routes
        // POST /ai/texture
        if (request.method === "POST" && url.pathname === "/ai/texture") {
            const { prompt } = await request.json() as { prompt: string };
            const features = await import("./agent/features.ts");
            const imageStream = await features.generateTexture(env.AI, prompt);

            return new Response(imageStream, {
                headers: { "Content-Type": "image/png" }
            });
        }

        // POST /ai/transcribe
        if (request.method === "POST" && url.pathname === "/ai/transcribe") {
            const audioData = await request.arrayBuffer();
            const features = await import("./agent/features.ts");
            const text = await features.transcribeAudio(env.AI, audioData);

            return new Response(JSON.stringify({ text }), {
                headers: { "Content-Type": "application/json" }
            });
        }

        // 5. File System Routes (Phase 4)
        if (request.method === "GET" && url.pathname === "/fs/list") {
            const vfs = await import("./services/vfs.ts");
            const fs = new vfs.VirtualFileSystem(env.ASSETS);
            const list = await fs.list();
            return new Response(JSON.stringify(list), { headers: { "Content-Type": "application/json" } });
        }

        if (request.method === "POST" && url.pathname === "/fs/create") {
            const vfs = await import("./services/vfs.ts");
            const fs = new vfs.VirtualFileSystem(env.ASSETS);
            const { path, content, type } = await request.json() as any;

            if (type === 'dir') {
                await fs.createFolder(path);
            } else {
                await fs.createFile(path, content || "");
            }
            return new Response("Created", { status: 201 });
        }

        if (request.method === "GET" && url.pathname === "/fs/read") {
            const vfs = await import("./services/vfs.ts");
            const fs = new vfs.VirtualFileSystem(env.ASSETS);
            const path = url.searchParams.get("path");

            if (!path) return new Response("Missing path", { status: 400 });

            const content = await fs.readFile(path);
            if (content === null) return new Response("Not Found", { status: 404 });

            return new Response(content);
        }

        // 6. GitHub Routes (Phase 5)
        if (request.method === "GET" && url.pathname === "/auth/github/login") {
            const redirectUri = "https://github.com/login/oauth/authorize";
            const clientId = env.GITHUB_CLIENT_ID;
            return Response.redirect(`${redirectUri}?client_id=${clientId}&scope=repo,user`, 302);
        }

        if (request.method === "GET" && url.pathname === "/auth/github/callback") {
            const code = url.searchParams.get("code");
            if (!code) return new Response("Missing code", { status: 400 });

            const githubService = await import("./services/github.ts");
            const gh = new githubService.GitHubService(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET);

            const token = await gh.getAccessToken(code);
            if (!token) return new Response("Failed to get token", { status: 400 });

            // Store token in cookie and close popup
            const html = `
            <script>
                // Send token to parent window
                window.opener.postMessage({ type: 'GITHUB_TOKEN', token: '${token}' }, '*');
                window.close();
            </script>
            <h1>Login Successful. Closing...</h1>`;

            return new Response(html, { headers: { "Content-Type": "text/html" } });
        }

        if (request.method === "GET" && url.pathname === "/github/repos") {
            const token = request.headers.get("Authorization")?.replace("Bearer ", "");
            if (!token) return new Response("Missing token", { status: 401 });

            const githubService = await import("./services/github.ts");
            const gh = new githubService.GitHubService(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET);

            try {
                const repos = await gh.listRepos(token);
                return new Response(JSON.stringify(repos), { headers: { "Content-Type": "application/json" } });
            } catch (e) {
                return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
            }
        }

        // 7. Utility Routes
        if (url.pathname === "/favicon.ico") {
            return new Response(null, { status: 204 });
        }

        // 5. Agent API (Legacy/Core)
        if (request.method === "POST" && url.pathname === "/agent/run") {
            const api = await import("./api.ts");
            return api.handleRequest(request, env);
        }

        return new Response("Not Found", { status: 404 });
    }
};
