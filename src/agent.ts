import { AIChatAgent } from "agents/ai-chat-agent";
import { ModelMessage as Message } from "ai";
import { Env, MODELS, runAI } from "./index";
import { classifyTask, getModelDisplayName, getTaskIcon, type ModelKey, getSpecialistForTask } from "./modelRouter";

const WORKSPACE_PREFIX = 'projects/default/';
const LOCAL_BRIDGE_URL = 'http://127.0.0.1:3040';

const SYSTEM_INSTRUCTION_MODIFIER = `
You are the **COMMANDER AGENT** (Lead Architect).
Your objective is to orchestrate complex tasks by delegating to specialized Sub-Agents (Tools).

**CRITICAL PROTOCOLS:**
1. **IMAGE COMMS (Artist)**: If user asks for an image, you MUST REWRITE the prompt to be highly detailed and artistic. Then call 'generate_image'.
   - IMPORTANT: DO NOT output any [IMAGE: ...] tag yourself. The tool will handle the preview.
2. **CODE COMMS (Coder)**: If user asks for code, do not just write it. CHECK files ('list_files', 'read_file') -> PLAN -> EXECUTE ('write_file' or 'terminal_exec').
   - IMPORTANT: DO NOT output any [TERM: ...] tag yourself. Execute directly through the Coder Sub-Agent (Terminal Tool).
3. **THOUGHTS (Thinker)**: Your reasoning will be containerized. Focus on the final DIRECTIVE in your response.
4. **REFRESH**: If you modify the workspace, ALWAYS end your response with the tag [REFRESH] to update the UI.
5. **OMNI-PIPELINE**: Coordinate the Sub-Agents to deliver a complete product. You have 5 turns to finalize the loop.
`;

export class CodeAgent extends AIChatAgent<Env> {
  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/api/chat') && request.method === 'POST') {
      return this.handleChatRequest(request);
    }
    return super.onRequest(request);
  }

  async handleChatRequest(request: Request): Promise<Response> {
    try {
      const rawText = await request.text();
      if (!rawText) throw new Error("Empty request body");

      const body = JSON.parse(rawText);
      let messages: any[] = body.messages || (body.message ? [{ role: 'user', content: body.message }] : []);
      if (body.history) messages = [...body.history, ...messages];

      const AI = this.env.AI;
      const bridgeUrl = body.bridge_url || LOCAL_BRIDGE_URL;

      // Helper for Task Queue Execution (PNA Bypass)
      const executeLocalTask = async (type: string, payload: any): Promise<any> => {
        const taskId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const TASK_QUEUE_PREFIX = 'task_queue:';
        const TASK_RESULT_PREFIX = 'task_result:';

        // 1. Queue Task in KV
        const task = { id: taskId, type, payload, status: 'pending', createdAt: Date.now() };
        await this.env.CACHE.put(`${TASK_QUEUE_PREFIX}${taskId}`, JSON.stringify(task), { expirationTtl: 300 });

        // 2. Poll for Result in KV (30s timeout)
        const startTime = Date.now();
        while (Date.now() - startTime < 30000) {
          await new Promise(r => setTimeout(r, 500));
          const resultData = await this.env.CACHE.get(`${TASK_RESULT_PREFIX}${taskId}`);
          if (resultData) {
            const result = JSON.parse(resultData);
            if (result.error) throw new Error(result.error);
            return result.result;
          }
        }
        throw new Error("Task timed out (Local Task Runner may not be running).");
      };

      // Define Tools
      const tools = [
        {
          name: "read_file",
          description: "Read a file from the workspace. Automatically prioritizes Local Bridge over Cloud (R2).",
          parameters: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"]
          },
          function: async ({ name }: { name: string }) => {
            // 1. Try Bridge first (Task Queue)
            try {
              const res = await executeLocalTask('fs.read', { name });
              if (res && res.content) return res.content;
            } catch (e) { console.warn("Bridge read failed (TaskQueue), falling back to R2:", e); }

            // 2. Fallback to R2
            const obj = await this.env.R2_ASSETS.get(WORKSPACE_PREFIX + name);
            return obj ? await obj.text() : "File not found.";
          }
        },
        {
          name: "write_file",
          description: "Write content to a file in the workspace via Local Bridge.",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string" },
              content: { type: "string" }
            },
            required: ["name", "content"]
          },
          function: async ({ name, content }: { name: string, content: string }) => {
            try {
              // Task Queue Write
              await executeLocalTask('fs.write', { name, content });
              return "File saved successfully (Local Task).";
            } catch (e) { return "Bridge error: " + (e as any).message; }
          }
        },
        {
          name: "cat_file",
          description: "Read a local file via bridge terminal.",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"]
          },
          function: async ({ path }: { path: string }) => {
            try {
              // Reuse fs.read for cat
              const res = await executeLocalTask('fs.read', { name: path });
              return res && res.content ? res.content : "No output.";
            } catch (e) { return "Bridge error: " + (e as any).message; }
          }
        },
        {
          name: "terminal_exec",
          description: "Execute a shell command locally.",
          parameters: {
            type: "object",
            properties: { command: { type: "string" } },
            required: ["command"]
          },
          function: async ({ command }: { command: string }) => {
            try {
              // Task Queue Terminal Execution
              const res = await executeLocalTask('terminal.exec', { command });
              return res.output || res.error || "Command executed (No output).";
            } catch (e) { return "Bridge error: " + (e as any).message; }
          }
        },
        {
          name: "generate_image",
          description: "Generate an image from a prompt. Styles: 'flux', 'sdxl', 'quality'.",
          parameters: {
            type: "object",
            properties: {
              prompt: { type: "string" },
              style: { type: "string", enum: ["flux", "sdxl", "quality", "lucid", "phoenix"], default: "quality" }
            },
            required: ["prompt"]
          },
          function: async ({ prompt, style }: { prompt: string, style?: string }) => {
            try {
              let modelId = MODELS.FLUX_DEV;
              if (style === 'sdxl') modelId = MODELS.SDXL;
              else if (style === 'flux') modelId = MODELS.FLUX;

              const response = await runAI(this.env, modelId, {
                prompt,
                num_steps: (modelId.includes('schnell') || modelId.includes('lightning')) ? 4 : (style === 'quality' ? 20 : 10)
              });

              let arrayBuffer = (response instanceof Uint8Array ? response.buffer : (response instanceof ArrayBuffer ? response : await new Response(response as any).arrayBuffer())) as ArrayBuffer;
              const bytes = new Uint8Array(arrayBuffer);
              const filename = `gen_${Date.now()}.png`;

              // 1. Save to R2 (Primary Gallery)
              await this.env.R2_ASSETS.put(WORKSPACE_PREFIX + filename, arrayBuffer, { httpMetadata: { contentType: 'image/png' } });

              // 2. BACKGROUND: Try saving to local bridge if available
              try {
                let binary = '';
                const chunkSize = 0x8000;
                for (let i = 0; i < bytes.byteLength; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength)));
                const base64 = btoa(binary);

                await fetch(bridgeUrl + "/api/fs/file", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: filename, content: base64, encoding: 'base64' })
                });
              } catch (e) { }

              // Base64 for chat preview
              let binary = '';
              const chunkSize = 0x8000;
              for (let i = 0; i < bytes.byteLength; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength)));
              return `IMAGE_GENERATED: ${filename}\nPreview: data:image/png;base64,${btoa(binary)}`;
            } catch (e: any) { return `Image error: ${e.message}`; }
          }
        },
        {
          name: "git_blame",
          description: "Retrieve Git blame info for a file via GitKraken MCP.",
          parameters: {
            type: "object",
            properties: { file: { type: "string" } },
            required: ["file"]
          },
          function: async ({ file }: { file: string }) => {
            try {
              const res = await fetch(bridgeUrl + "/api/mcp/gitkraken", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  method: "tools/call",
                  params: {
                    name: "mcp_GitKraken_git_blame",
                    arguments: { directory: ".", file }
                  }
                })
              });
              const data = await res.json() as any;
              return JSON.stringify(data.result || data.error || data);
            } catch (e) { return "GitKraken Bridge Error: " + (e as any).message; }
          }
        },
        {
          name: "git_log",
          description: "Retrieve Git commit log via GitKraken MCP.",
          parameters: {
            type: "object",
            properties: { n: { type: "number", default: 10 } },
            required: ["n"]
          },
          function: async ({ n }: { n: number }) => {
            try {
              const res = await fetch(bridgeUrl + "/api/mcp/gitkraken", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  method: "tools/call",
                  params: {
                    name: "mcp_GitKraken_git_log_or_diff",
                    arguments: { directory: ".", action: "log" }
                  }
                })
              });
              const data = await res.json() as any;
              return JSON.stringify(data.result || data.error || data);
            } catch (e) { return "GitKraken Bridge Error: " + (e as any).message; }
          }
        },
        {
          name: "ask_antigravity",
          description: "Query the Antigravity IDE's internal soul (Senior Architect) for high-level project context.",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"]
          },
          function: async ({ query }: { query: string }) => {
            try {
              // Read context from bridge
              const ctxRes = await fetch(bridgeUrl + "/api/antigravity/context");
              const context = await ctxRes.json() as any;

              // Forward to the Thinker model (DeepSeek R1) with contextual awareness
              const response = await runAI(this.env, MODELS.THINK, {
                messages: [
                  { role: 'system', content: `You are the Senior Architect of Antigravity IDE. You have access to the user's settings, project logs, and global state. Answer the query based on this context.\n\nIDE CONTEXT:\n${JSON.stringify(context, null, 2)}` },
                  { role: 'user', content: query }
                ]
              });
              return response.response || response.choices?.[0]?.message?.content || "No response from Senior Architect.";
            } catch (e) { return "Antigravity Bridge Error: " + (e as any).message; }
          }
        }
      ];

      const userText = messages.filter(m => m.role === 'user').pop()?.content || '';
      const requestedModel = body.model?.toUpperCase() as ModelKey;

      // --- PHASE 1: Thinking / Orchestration ---
      let orchestrationDecision = "CHAT";
      if (!requestedModel) {
        try {
          console.log(`🧠 Consulting General (DeepSeek R1) for Orchestration...`);
          const orchResponse = await runAI(this.env, MODELS.THINK, {
            messages: [
              { role: 'system', content: 'You are the Lead Architect. Determine the best specialist for this request. Output ONLY one word: "CODE" (if the user wants to write/fix/run code or terminal commands), "IMAGE" (if generating an image), "AGENT" (for research/searching/file reading), or "CHAT" (for general questions).' },
              { role: 'user', content: userText }
            ]
          });
          orchestrationDecision = (orchResponse.response || orchResponse.choices?.[0]?.message?.content || "CHAT").trim().toUpperCase();
        } catch (e) { console.error("Orchestration failed, falling back to pattern matching", e); }
      }

      const classification = classifyTask(userText, body.activeFile || '', !!body.image);
      let finalModelKey: ModelKey = (requestedModel && MODELS[requestedModel]) ? requestedModel : classification.suggestedModel;

      // Override with Orchestrator decision if no explicit model requested
      if (!requestedModel && ['CODE', 'IMAGE', 'AGENT'].includes(orchestrationDecision)) {
        finalModelKey = orchestrationDecision as ModelKey;
      }

      let modelId = MODELS[finalModelKey] || MODELS.DEFAULT;
      console.log(`🤖 Orchestrator: ${orchestrationDecision} -> specialist: ${finalModelKey} (${modelId})`);
      console.log(`🤖 Model: ${modelId} | Task: ${classification.task}`);

      if (!this.env.AI && !modelId.includes('gemini') && !modelId.includes('fireworks')) {
        throw new Error("Cloudflare AI binding is missing in this environment.");
      }

      let resultText = "";
      if (modelId.startsWith('@cf/')) {
        let currentMessages = messages.map(m => ({
          role: (m.role === 'ai' || m.role === 'assistant') ? 'assistant' : m.role,
          content: typeof m.content === 'string' ? m.content : (m.parts?.[0]?.text || String(m.content || ""))
        })).map(m => ({ role: m.role as "system" | "user" | "assistant" | "tool", content: m.content }));

        // Context-Aware System Prompt
        let systemPrompt = SYSTEM_INSTRUCTION_MODIFIER;
        if (finalModelKey === 'CODE') {
          systemPrompt += `\n\n[SPECIALIST: CODE AGENT]\nYour goal is ACTION. You have full terminal access. Use 'terminal_exec' to run commands, 'cat_file' or 'read_file' to understand context, and apply changes immediately. Don't just explain; DO.`;
        } else if (finalModelKey === 'AGENT') {
          systemPrompt += `\n\n[SPECIALIST: RESEARCH AGENT]\nYour goal is KNOWLEDGE. Use 'SEARCH' and 'read_file' to gather all facts before answering. Be thorough.`;
        }

        if (!currentMessages.find(m => m.role === 'system')) {
          currentMessages.unshift({ role: 'system', content: systemPrompt });
        }

        let turn = 0;
        let lastResponseContent = "";

        while (turn < 5) {
          turn++;

          // --- SYMPHONY LOGIC: Turn-Based Specialist Selector ---
          // Every turn, the Boss (Commander) can switch to a specialist.
          // Turn 1 is ALWAYS the Boss (Commander Planning Phase).
          let turnModelKey = finalModelKey;
          if (turn > 1) {
            turnModelKey = getSpecialistForTask(lastResponseContent, turn);
            const specialistId = MODELS[turnModelKey] || MODELS.DEFAULT;
            modelId = specialistId; // Switch current model for this turn
            console.log(`[SYMPHONY] Turn ${turn} Handoff -> ${turnModelKey} (${modelId})`);
            // Add a marker for the UI if possible (optional, but good for logs)
          }

          try {
            const response = await (AI as any).run(modelId, { messages: currentMessages, tools });
            if (!response) throw new Error("AI returned nothing");

            const toolCalls = response.tool_calls || response.message?.tool_calls || [];
            const responseText = response.response || response.message?.content || (typeof response === 'string' ? response : "");
            lastResponseContent = responseText;

            if (toolCalls.length > 0) {
              console.log(`[SYMPHONY] Turn ${turn} Tool Calls:`, toolCalls.length);
              currentMessages.push({ role: "assistant", content: responseText || "One moment..." });
              for (const call of toolCalls) {
                const tool = tools.find(t => t.name === call.name);
                console.log(`[SYMPHONY] Calling Tool: ${call.name}`);
                const toolResult = tool ? await tool.function(call.arguments) : "Tool not found.";
                (currentMessages as any).push({ role: "tool", content: toolResult, tool_call_id: call.id || call.name, name: call.name });
              }
            } else {
              resultText = responseText;
              break;
            }
          } catch (e: any) {
            console.error(`[SYMPHONY] Turn ${turn} Error:`, e.message);
            resultText = `Error during turn ${turn}: ${e.message}`;
            break;
          }
        }
      } else {
        const provider = modelId.includes('fireworks') ? 'fireworks' : (modelId.includes('openrouter') ? 'openrouter' : (modelId.includes('gemini') ? 'gemini' : 'workers-ai'));
        const aiResponse = await runAI(this.env, modelId, {
          messages: messages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : (m.parts?.[0]?.text || String(m.content || "")) }))
        }, provider);
        resultText = aiResponse.choices?.[0]?.message?.content || aiResponse.candidates?.[0]?.content?.parts?.[0]?.text || (typeof aiResponse === 'string' ? aiResponse : JSON.stringify(aiResponse));
      }

      resultText = resultText.replace(/<\|.*?\|>/g, "").trim() || "I couldn't process that request.";

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: resultText })}\n\n`));
          controller.close();
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        }
      });
    } catch (e: any) {
      console.error("CodeAgent Fatal Error:", e.message);
      const errorMsg = `[FATAL AGENT ERROR]: ${e.message}`;
      return new Response(JSON.stringify({ error: errorMsg }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'X-Debug-Error': e.message.substring(0, 100)
        }
      });
    }
  }
}
