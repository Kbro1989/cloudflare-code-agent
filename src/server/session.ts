import { DurableObject } from "cloudflare:workers";
import { Env } from "../index";
import { executeTask } from "../agent/execute";

function inferIntent(input: string): string {
    if (input.match(/explain|what does|how does|analysis/i)) return "explain";
    if (input.match(/review|critique|audit/i)) return "review";
    if (input.match(/error|exception|fix|debug/i)) return "debug";
    if (input.match(/refactor|improve|optimi/i)) return "optimize";
    return "implement";
}

interface SessionState {
    files: Record<string, any>;
    history: any[];
}

export class Session extends DurableObject {
    state: DurableObjectState;
    env: Env;
    sessions: Set<WebSocket>;

    constructor(state: DurableObjectState, env: Env) {
        super(state, env);
        this.state = state;
        this.env = env;
        this.sessions = new Set();

        // Initialize SQLite Schema
        const sql = this.state.storage.sql;
        sql.exec(`
            CREATE TABLE IF NOT EXISTS files (
                path TEXT PRIMARY KEY,
                content TEXT,
                language TEXT
            );
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT,
                content TEXT,
                timestamp INTEGER
            );
        `);

        // Seed default file if empty
        const existing = sql.exec("SELECT path FROM files LIMIT 1").toArray();
        if (existing.length === 0) {
            sql.exec("INSERT INTO files (path, content, language) VALUES (?, ?, ?)",
                "main.ts",
                "// Welcome to your Cloudflare Code Agent\n// Start building your worker or logic here.\n\nconsole.log('Hello World');",
                "typescript"
            );
        }
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        // WebSocket Upgrade
        if (url.pathname.endsWith("/ws")) {
            const upgradeHeader = request.headers.get("Upgrade");
            if (!upgradeHeader || upgradeHeader !== "websocket") {
                return new Response("Expected Upgrade: websocket", { status: 426 });
            }

            const webSocketPair = new WebSocketPair();
            const [client, server] = Object.values(webSocketPair);

            this.handleSession(server);
            return new Response(null, { status: 101, webSocket: client });
        }

        // Direct HTTP API
        if (request.method === "GET") {
            const data = this.loadState();
            return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
        }

        if (request.method === "POST") {
            const body = await request.json() as any;

            // Agent Run
            if (url.pathname.includes("/agent/run") || body.input) {
                const historyState = this.loadState().history;
                const history = historyState.map((h: any) => ({ role: h.role, content: h.content }));

                const intent = inferIntent(body.input);
                const result = await executeTask({
                    ai: this.env.AI,
                    model: body.model || "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
                    input: body.input,
                    files: body.files,
                    intent,
                    history,
                    sessionId: "session"
                });

                if (!result.error) {
                    this.state.storage.sql.exec("INSERT INTO history (role, content, timestamp) VALUES (?, ?, ?)", "user", body.input, Date.now());
                    const responseContent = result.artifact || result.response || "Task completed.";
                    this.state.storage.sql.exec("INSERT INTO history (role, content, timestamp) VALUES (?, ?, ?)", "assistant", responseContent, Date.now());
                }

                return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
            }

            // Standard Update
            if (body.files) this.updateFiles(body.files);

            const data = this.loadState();
            this.broadcast({ type: "update", data });
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        return new Response("Not Found", { status: 404 });
    }

    loadState(): SessionState {
        const sql = this.state.storage.sql;
        const filesRows = sql.exec("SELECT path, content, language FROM files").toArray();
        const files: Record<string, any> = {};
        for (const row of filesRows as any[]) {
            files[row.path] = { content: row.content, language: row.language };
        }
        const history = sql.exec("SELECT role, content FROM history ORDER BY timestamp ASC").toArray();
        return { files, history };
    }

    updateFiles(files: Record<string, any>) {
        const sql = this.state.storage.sql;
        for (const [rawPath, file] of Object.entries(files)) {
            const path = rawPath.trim();
            sql.exec(`
                INSERT INTO files (path, content, language) 
                VALUES (?, ?, ?) 
                ON CONFLICT(path) DO UPDATE SET content=excluded.content, language=excluded.language
            `, path, file.content, file.language);
        }
    }

    handleSession(webSocket: WebSocket) {
        this.sessions.add(webSocket);
        webSocket.accept();
        webSocket.send(JSON.stringify({ type: "init", data: this.loadState() }));

        webSocket.addEventListener("message", async (msg) => {
            try {
                const event = JSON.parse(msg.data as string);
                if (event.type === "update") {
                    if (event.data.files) this.updateFiles(event.data.files);
                    const newState = this.loadState();
                    this.broadcast({ type: "update", data: newState }, webSocket);
                }
            } catch (err) {
                console.error(err);
            }
        });

        webSocket.addEventListener("close", () => {
            this.sessions.delete(webSocket);
        });
    }

    broadcast(message: any, exclude?: WebSocket) {
        const msg = JSON.stringify(message);
        this.sessions.forEach(session => {
            if (session !== exclude) session.send(msg);
        });
    }
}
