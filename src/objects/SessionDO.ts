import { DurableObject } from "cloudflare:workers";
import { Env } from "../index";

interface SessionState {
    files: Record<string, any>;
    history: any[];
}

export class SessionDO extends DurableObject {
    private state: DurableObjectState;
    private env: Env;
    private sessions: Set<WebSocket>;
    private data: SessionState;

    constructor(state: DurableObjectState, env: Env) {
        super(state, env);
        this.state = state;
        this.env = env;
        this.sessions = new Set();
        this.data = { files: {}, history: [] };

        // Restore state from storage (block to ensure consistency)
        this.state.blockConcurrencyWhile(async () => {
            const stored = await this.state.storage.get("data");
            if (stored) {
                this.data = stored as SessionState;
            } else {
                // Try to restore from R2 if not in DO storage (Migration path)
                // simplified for now: just start empty if no local storage
            }
        });
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

        // Direct HTTP API (for initial load)
        if (request.method === "GET") {
            return new Response(JSON.stringify(this.data), { headers: { "Content-Type": "application/json" } });
        }

        if (request.method === "POST") {
            const body = await request.json() as any;
            if (body.files) this.data.files = body.files;
            if (body.history) this.data.history = body.history;
            this.broadcast({ type: "update", data: this.data });
            await this.save();
            return new Response("Saved", { status: 200 });
        }

        return new Response("Not Found", { status: 404 });
    }

    handleSession(webSocket: WebSocket) {
        this.sessions.add(webSocket);
        webSocket.accept();

        // Send initial state
        webSocket.send(JSON.stringify({ type: "init", data: this.data }));

        webSocket.addEventListener("message", async (msg) => {
            try {
                const event = JSON.parse(msg.data as string);
                if (event.type === "update") {
                    // Trust client state for now (Last Write Wins)
                    if (event.data.files) this.data.files = event.data.files;
                    if (event.data.history) this.data.history = event.data.history;
                    await this.save();
                    // Broadcast to others
                    this.broadcast(event, webSocket);
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

    async save() {
        await this.state.storage.put("data", this.data);
        // Async R2 backup (fire and forget)
        const key = `snapshot-${Date.now()}.json`;
        this.env.WORKSPACE_BUCKET.put(key, JSON.stringify(this.data)).catch(console.error);
    }
}
