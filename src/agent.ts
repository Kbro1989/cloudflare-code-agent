import { AIChatAgent } from "agents/ai-chat-agent";
import { ModelMessage as Message } from "ai";
import { runWithTools } from "@cloudflare/ai-utils";
import { Env } from "./index";

const WORKSPACE_PREFIX = 'projects/default/';

export class CodeAgent extends AIChatAgent<Env> {
  async onChatMessage(): Promise<Response | undefined> {
    const { AI } = this.env;

    // Define the toolset for the agent
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
          // We can use the local bridge for fast searching if connected
          try {
            const res = await fetch("http://127.0.0.1:3000/api/fs/search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pattern: query })
            });
            if (res.ok) return await res.text();
          } catch (e) { }

          return "Search failed: Local bridge not reachable or search exceeded memory.";
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
            const res = await fetch("http://127.0.0.1:3000/api/terminal", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ command, cwd: "./workspace" })
            });
            return await res.text();
          } catch (e) {
            return "Error: Terminal bridge not reachable.";
          }
        }
      }
    ];

    // Core Agent Brain: Use runWithTools to orchestrate the conversation
    // This handles the thought -> tool-call -> tool-result -> response loop automatically.
    // @ts-ignore
    const result = await runWithTools(
      AI,
      "@hf/nousresearch/hermes-2-pro-mistral-7b",
      {
        // @ts-ignore
        messages: this.messages.map(m => ({
          role: m.role,
          // @ts-ignore
          content: typeof m.content === 'string' ? m.content : (m.parts?.[0]?.text || "")
        })),
        tools: tools,
      }
    );

    // Persist messages to the Agent's SQLite store (automatic via AIChatAgent if we return Response)
    return new Response(JSON.stringify(result));
  }
}
