import { DurableObject } from "cloudflare:workers";
import { Env } from "../index";

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
            if (body.files) this.updateFiles(body.files);

            const data = this.loadState();
            this.broadcast({ type: "update", data });
            return new Response("Saved", { status: 200 });
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
        for (const [path, file] of Object.entries(files)) {
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
