import { AIChatAgent } from "agents/ai-chat-agent";
import { ModelMessage as Message } from "ai";
import { runWithTools } from "@cloudflare/ai-utils";
import { Env } from "./index";

const WORKSPACE_PREFIX = 'projects/default/';

export class CodeAgent extends AIChatAgent<Env> {
  async onChatMessage(): Promise<Response | undefined> {
    try {
      const { AI } = this.env;
      if (!AI) throw new Error("AI Binding is missing in the Agent environment.");

      console.log("📨 CodeAgent: Received message...");

      // Defensively handle this.messages which might be an object or getter
      const rawMessages = (this as any).messages;
      const msgs = Array.isArray(rawMessages) ? rawMessages : (typeof rawMessages?.getMessages === 'function' ? await rawMessages.getMessages() : []);

      console.log(`📜 Message count: ${msgs.length}`);

      const tools: any = [
        {
          name: "list_files",
          description: "List all files in the current workspace to understand project structure.",
          parameters: {
            type: "object",
            properties: {},
          },
          function: async () => {
            const listed = await this.env.R2_ASSETS.list({ prefix: WORKSPACE_PREFIX });
            const files = listed.objects.map(o => o.key.replace(WORKSPACE_PREFIX, ''));
            return JSON.stringify({ files, total: files.length });
          }
        },
        {
          name: "read_file",
          description: "Read the content of a specific file.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "The relative path to the file." }
            },
            required: ["path"]
          },
          function: async ({ path }: { path: string }) => {
            const fullPath = path.startsWith(WORKSPACE_PREFIX) ? path : WORKSPACE_PREFIX + path;
            const obj = await this.env.R2_ASSETS.get(fullPath);
            if (!obj) return `Error: File '${path}' not found.`;
            const content = await obj.text();
            return content;
          }
        },
        {
          name: "search_code",
          description: "Search for a pattern or string across the codebase.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "The search pattern (regex supported)." }
            },
            required: ["query"]
          },
          function: async ({ query }: { query: string }) => {
            try {
              const res = await fetch("http://127.0.0.1:3030/api/fs/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pattern: query })
              });
              if (res.ok) return await res.text();
            } catch (e) { }
            return "Search failed: Local bridge not reachable on port 3030.";
          }
        },
        {
          name: "terminal_exec",
          description: "Execute a command in the local bridge terminal (e.g., npm build, ls).",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string", description: "The shell command to execute." }
            },
            required: ["command"]
          },
          function: async ({ command }: { command: string }) => {
            try {
              const res = await fetch("http://127.0.0.1:3030/api/terminal", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ command })
              });
              return await res.text();
            } catch (e) {
              return "Error: Terminal bridge not reachable on port 3030.";
            }
          }
        },
        {
          name: "git_exec",
          description: "Execute git commands locally. Requires local bridge.",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string", description: "The git command to execute (e.g., 'status', 'add .')." }
            },
            required: ["command"]
          },
          function: async ({ command }: { command: string }) => {
            try {
              const fullCommand = command.startsWith("git ") ? command : `git ${command}`;
              const res = await fetch("http://127.0.0.1:3030/api/terminal", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ command: fullCommand })
              });
              return await res.text();
            } catch (e) {
              return "Error: Local bridge not reachable for git operations.";
            }
          }
        },
        {
          name: "blender_run",
          description: "Run a Python script in Blender (background mode) to generate or edit 3D models.",
          parameters: {
            type: "object",
            properties: {
              script: { type: "string", description: "The Python script to execute within Blender." },
              args: { type: "array", items: { type: "string" }, description: "Optional arguments for the script." }
            },
            required: ["script"]
          },
          function: async ({ script, args = [] }: { script: string, args?: string[] }) => {
            try {
              const res = await fetch("http://127.0.0.1:3030/api/blender/run", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ script, args })
              });
              const data = await res.json() as any;
              return data.success ? `Success!\n${data.output}` : `Failed: ${data.error}`;
            } catch (e: any) {
              return `Error: Blender bridge not reachable. ${e.message}`;
            }
          }
        }
      ];

      const modelId = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
      console.log(`🤖 Agent thinking with ${modelId}...`);

      const result = await (runWithTools as any)(
        AI,
        modelId,
        {
          messages: msgs.map((m: any) => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : (m.parts?.[0]?.text || String(m.content || ""))
          })),
          tools: tools,
        }
      );

      console.log("✅ CodeAgent: Response generated.");
      return new Response(JSON.stringify(result));
    } catch (e: any) {
      console.error("CodeAgent Error:", e.message);
      return new Response(JSON.stringify({
        error: `Agent Error: ${e.message}`,
        provider: 'error-handler'
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }
}
