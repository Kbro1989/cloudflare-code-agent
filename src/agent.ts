import { AIChatAgent } from "agents/ai-chat-agent";
import { ModelMessage as Message } from "ai";
import { Env, MODELS, runAI } from "./index";
import { classifyTask, getModelDisplayName, getTaskIcon, type ModelKey } from "./modelRouter";

const WORKSPACE_PREFIX = 'projects/default/';
const LOCAL_BRIDGE_URL = 'http://127.0.0.1:3040';

const SYSTEM_INSTRUCTION_MODIFIER = `
You are the **COMMANDER AGENT**. You are the "Boss" of this workspace.
Your job is to orchestrate tasks by delegating them to your specialized tools (Processors).

**YOUR ARSENAL:**
- **Local Bridge (Sub-Agent Coder)**: 'read_file', 'write_file', 'list_files', 'terminal_exec'. Use these for ALL coding and tech tasks.
- **Flux/SDXL (Sub-Agent Artist)**: 'generate_image'. Use this for visuals.
- **DeepSeek (Sub-Agent Thinker)**: (Internal) Use your own reasoning capabilities before answering.

**CRITICAL PROTOCOLS:**
1. **IMAGE COMMS**: If user asks for an image, you MUST REWRITE the prompt to be highly detailed and artistic before calling 'generate_image'. Do not use their raw simple text.
   - Example: User "draw a cat" -> Tool call prompt "hyper-realistic close-up of a maine coon cat, cinematic lighting, 8k resolution..."
2. **CODE COMMS**: If user asks for code, do not just write it. CHECK if files exist ('list_files', 'read_file') -> PLAN -> EXECUTE ('write_file').
3. **VOICE/AUDIO**: If the user mentions voice/audio input, acknowledge that you are listening via the Neural Link.

**EXECUTION RULES:**
- IMMEDIATELY call tools. Do not wait.
- Do not explain your plan, just execute the first step.
- HIDE your internal monologue (it will be containerized by the system).
- ALWAYS end with a [REFRESH] tag if you modified the workspace.
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
            // 1. Try Bridge first
            try {
              const res = await fetch(bridgeUrl + "/api/exec", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ command: `cat ${name}` })
              });
              const data = await res.json() as any;
              if (data.success && data.stdout) return data.stdout;
            } catch (e) { console.warn("Bridge read failed, falling back to R2"); }

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
              // We use /api/fs/file on the bridge for reliable binary/text writing
              const res = await fetch(bridgeUrl + "/api/fs/file", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, content })
              });
              const data = await res.json() as any;
              return data.success ? "File saved successfully." : `Error: ${data.error}`;
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
              const res = await fetch(bridgeUrl + "/api/exec", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ command: `cat ${path}` })
              });
              const data = await res.json() as any;
              return data.stdout || data.error || "No output.";
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
              const res = await fetch(bridgeUrl + "/api/exec", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ command, persistent: true })
              });
              const data = await res.json() as any;
              return data.success ? (data.stdout || "Success.") : `Error: ${data.error}`;
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

      const modelId = MODELS[finalModelKey] || MODELS.DEFAULT;
      console.log(`🤖 Orchestrator: ${orchestrationDecision} -> specialist: ${finalModelKey} (${modelId})`);

      console.log(`🤖 Model: ${modelId} | Task: ${classification.task}`);

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
        while (turn < 3) {
          turn++;
          const response = await (AI as any).run(modelId, { messages: currentMessages, tools });
          if (!response) throw new Error("AI returned nothing");

          const toolCalls = response.tool_calls || response.message?.tool_calls || [];
          const responseText = response.response || response.message?.content || (typeof response === 'string' ? response : "");

          if (toolCalls.length > 0) {
            currentMessages.push({ role: "assistant", content: responseText || "One moment..." });
            for (const call of toolCalls) {
              const tool = tools.find(t => t.name === call.name);
              const toolResult = tool ? await tool.function(call.arguments) : "Tool not found.";
              (currentMessages as any).push({ role: "tool", content: toolResult, tool_call_id: call.id || call.name, name: call.name });
            }
          } else {
            resultText = responseText;
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
      console.error("CodeAgent Error:", e.message);
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
  }
}
