import { Ai } from '@cloudflare/ai';
import Cloudflare from 'cloudflare';

export interface Env {
  AI: Ai;
  CACHE: KVNamespace;
  R2_ASSETS: R2Bucket;
  GENERATE_API_KEY?: string; // Legacy/Fallback
  OLLAMA_URL?: string;     // Legacy/Fallback
  OLLAMA_AUTH_TOKEN?: string;
  MAX_CACHE_SIZE: number;
  // Deployment Secrets
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  DISPATCHER?: any; // DispatchNamespace binding
}

// ----------------------------------------------------------------------------
// Model Registry - The Brains & Artists
// ----------------------------------------------------------------------------
const MODELS = {
  // Text / Coding
  DEFAULT: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  REASONING: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',

  // Image Gen
  FLUX: '@cf/black-forest-labs/flux-1-schnell',
  SDXL: '@cf/bytedance/stable-diffusion-xl-lightning',
  DREAMSHAPER: '@cf/lykon/dreamshaper-8-lcm',

  // Vision
  LLAVA: '@cf/llava-hf/llava-1.5-7b-hf',
  RESNET: '@cf/microsoft/resnet-50'
};

const SYSTEM_PROMPT = `
You are an advanced AI coding agent (Omni-Dev Level).
You have access to the user's local filesystem via the CLI.
Tools:
1. readFile(path)
2. writeFile(path, content)
3. listFiles(path)
4. runCommand(cmd)

Output JSON tool calls wrapped in \`\`\`json blocks.
`;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // ... (CORS Headers remain same)
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-AI-Provider, X-AI-Cost',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Serve UI
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const { IDE_HTML } = await import('./ui');
      return new Response(String(IDE_HTML), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // Serve ui.js
    if (url.pathname === '/ui.js') {
      // Correctly import and serve the JavaScript file as a string
      const uiJsContent = await import('./ui.js');
      return new Response(uiJsContent.UI_JS, {
        headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
      });
    }
    
    // Router
    try {
      switch (url.pathname) {
        case '/api/complete':
          return handleComplete(request, env, ctx, corsHeaders);
        case '/api/explain':
          return handleExplain(request, env, ctx, corsHeaders);
        case '/api/chat':
          return handleChat(request, env, ctx, corsHeaders);
        case '/api/image':
          return handleImage(request, env, ctx, corsHeaders);
        case '/api/deploy': // New Endpoint
          return handleDeploy(request, env, corsHeaders);
        case '/api/fs/list':
        case '/api/fs/file':
          return handleFilesystem(request, env, corsHeaders);
        case '/api/health':
          return handleHealth(request, env, corsHeaders);
        default:
          return new Response('Not Found', { status: 404, headers: corsHeaders });
      }
    } catch (e: any) {
      return new Response(`Server Error: ${e.message}`, { status: 500, headers: corsHeaders });
    }
  }
};

// ----------------------------------------------------------------------------
// Deployment Handler (Self-Replication)
// ----------------------------------------------------------------------------
async function handleDeploy(request: Request, env: Env, corsHeaders: any): Promise<Response> {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID || !env.DISPATCHER) {
    return new Response('Deployment secrets missing (API_TOKEN, ACCOUNT_ID, or DISPATCHER)', { status: 500, headers: corsHeaders });
  }

  const { scriptName, code } = await request.json() as any;
  if (!scriptName || !code) return new Response('Missing scriptName or code', { status: 400, headers: corsHeaders });

  try {
    const result = await deploySnippetToNamespace(
      {
        namespaceName: "code-agent-dispatcher", // Matches wrangler.toml
        scriptName,
        code,
      },
      env
    );
    return json({ success: true, result }, 200, corsHeaders);
  } catch (e: any) {
    return new Response(`Deploy Failed: ${e.message}`, { status: 500, headers: corsHeaders });
  }
}

async function deploySnippetToNamespace(
  opts: {
    namespaceName: string;
    scriptName: string;
    code: string;
    bindings?: any[];
  },
  env: Env
) {
  const { namespaceName, scriptName, code, bindings = [] } = opts;

  const cf = new Cloudflare({
    apiToken: env.CLOUDFLARE_API_TOKEN,
  });

  // Ensure dispatch namespace exists
  try {
    // @ts-ignore
    await cf.workersForPlatforms.dispatch.namespaces.get(namespaceName, {
      account_id: env.CLOUDFLARE_ACCOUNT_ID!,
    });
  } catch {
    // @ts-ignore
    await cf.workersForPlatforms.dispatch.namespaces.create({
      account_id: env.CLOUDFLARE_ACCOUNT_ID!,
      name: namespaceName,
    });
  }

  const moduleFileName = `${scriptName}.mjs`;

  // Upload worker to namespace
  // @ts-ignore
  await cf.workersForPlatforms.dispatch.namespaces.scripts.update(
    namespaceName,
    scriptName,
    {
      account_id: env.CLOUDFLARE_ACCOUNT_ID!,
      metadata: {
        main_module: moduleFileName,
        bindings,
      },
      files: [
        new File([code], moduleFileName, {
          type: "application/javascript+module",
        }),
      ],
    },
  );

  return { namespace: namespaceName, script: scriptName };
}

// ... (Rest of existing functions from handleImage downwards)

// ----------------------------------------------------------------------------
// Image Generation Router
// ----------------------------------------------------------------------------
async function handleImage(request: Request, env: Env, ctx: ExecutionContext, corsHeaders: any): Promise<Response> {
  if (!env.AI) return new Response('Workers AI binding missing', { status: 500, headers: corsHeaders });

  const { prompt, style } = await request.json() as any;
  if (!prompt) return new Response('Missing prompt', { status: 400, headers: corsHeaders });

  try {
    // Select Model based on Style
    let modelId = MODELS.FLUX; // Default
    let steps = 4; // Flux default

    if (style === 'realism') {
      modelId = MODELS.SDXL;
      steps = 8; // SDXL Lightning good around 4-8
    } else if (style === 'artistic') {
      modelId = MODELS.DREAMSHAPER;
      steps = 6; // Dreamshaper LCM is fast
    }

    // @ts-ignore
    const inputs = { prompt: prompt, num_steps: steps };

    // @ts-ignore
    const response = await env.AI.run(modelId, inputs);

    // Convert binary stream to base64 (Optimized for large files)
    // @ts-ignore
    const arrayBuffer = await new Response(response as any).arrayBuffer();

    // Use smaller chunks to avoid stack overflow
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const len = bytes.byteLength;
    const chunkSize = 0x8000; // 32KB chunks

    for (let i = 0; i < len; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
      binary += String.fromCharCode(...chunk);
    }

    const base64 = btoa(binary);
    const dataUrl = `data:image/png;base64,${base64}`;

    return json({ image: dataUrl, provider: modelId, style: style || 'speed' }, 200, corsHeaders);
  } catch (e: any) {
    return new Response(`Image Gen Failed: ${e.message}`, { status: 500, headers: corsHeaders });
  }
}

// ----------------------------------------------------------------------------
// Health & Status
// ----------------------------------------------------------------------------
async function incrementKVQuota(env: Env) {
  const today = new Date().toISOString().split('T')[0];
  const count = parseInt(await env.CACHE.get(`kvWriteCount:${today}`) || '0');
  await env.CACHE.put(`kvWriteCount:${today}`, (count + 1).toString());
}

async function handleHealth(request: Request, env: Env, corsHeaders: any): Promise<Response> {
  // ... (Keep existing health check logic, streamlined)
  const status: any = { status: 'healthy', provider: 'workers-ai' };
  return json(status, 200, corsHeaders);
}

// ----------------------------------------------------------------------------
// AI Completion (Multi-Model)
// ----------------------------------------------------------------------------
async function handleComplete(request: Request, env: Env, ctx: ExecutionContext, corsHeaders: any): Promise<Response> {
  const { fileId, code, cursor, language, prompt, model } = await request.json() as any;

  // Select Model
  const selectedModel = model === 'thinking' ? MODELS.REASONING : MODELS.DEFAULT;

  // Build prompt
  const before = code ? code.substring(Math.max(0, cursor - 1000), cursor) : ''; // Increased context
  const after = code ? code.substring(cursor, Math.min(code.length, cursor + 500)) : '';
  const finalPrompt = prompt || `Complete this ${language} code:\n${before}<CURSOR>${after}\n\nOutput only the completion:`;

  if (env.AI) {
    try {
      // Streaming logic
      // @ts-ignore
      const stream: any = await (env.AI as any).run(selectedModel, {
        prompt: finalPrompt,
        max_tokens: 512, // More tokens for reasoning
      }, { returnRawResponse: true });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'X-AI-Provider': selectedModel,
          ...corsHeaders
        }
      });
    } catch (e: any) {
      // Fallback or error
      return new Response(`AI Error: ${e.message}`, { status: 500, headers: corsHeaders });
    }
  }
  return new Response('AI Binding Missing', { status: 500, headers: corsHeaders });
}

// ----------------------------------------------------------------------------
// Chat (Multi-Model)
// ----------------------------------------------------------------------------
async function handleChat(request: Request, env: Env, ctx: ExecutionContext, corsHeaders: any): Promise<Response> {
  const { message, history = [], model, image } = await request.json() as any;

  // --------------------------------------------------------------------------
  // Vision Flow (LLaVA)
  // --------------------------------------------------------------------------
  if (image) {
    const obj = await env.R2_ASSETS.get(WORKSPACE_PREFIX + image);
    if (!obj) return new Response('Image not found in R2', { status: 404, headers: corsHeaders });

    const arrayBuffer = await obj.arrayBuffer();
    const inputs = {
      image: [...new Uint8Array(arrayBuffer)],
      prompt: message,
      max_tokens: 512
    };

    try {
      // @ts-ignore
      const response = await env.AI.run(MODELS.LLAVA, inputs) as any;
      // LLaVA output format: { description: "..." }
      const text = response.description || response.response || "No description generated.";

      // Fake stream response for UI compatibility
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      // Write single chunk
      await writer.write(encoder.encode(`data: ${JSON.stringify({
        token: text,
        provider: 'llava (vision)'
      })}\n\n`));
      await writer.close();

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'X-AI-Provider': 'llava',
          ...corsHeaders
        }
      });
    } catch (e: any) {
      return new Response(`Vision Error: ${e.message}`, { status: 500, headers: corsHeaders });
    }
  }

  // Select Model: 'thinking' -> DeepSeek, else Llama
  const selectedModel = model === 'thinking' ? MODELS.REASONING : MODELS.DEFAULT;
  const isDeepSeek = selectedModel === MODELS.REASONING;

  // DeepSeek R1 works best with "User: ... Assistant: ..." standard prompting or specific chat inputs
  // Llama 3.3 handles array of messages well

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-10), // Keep last 10
    { role: 'user', content: message }
  ];

  if (env.AI) {
    try {
      // @ts-ignore
      const stream: any = await (env.AI as any).run(selectedModel, {
        messages: messages, // Most Workers AI chat models accept messages array
        max_tokens: isDeepSeek ? 2048 : 1024, // Reasoning needs more room
      }, {
        returnRawResponse: true
      });

      // Transform stream to Client-Side format
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const reader = stream.body?.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();

      if (reader) {
        ctx.waitUntil((async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value, { stream: true });
              // Workers AI stream format: data: {"response":"..."}
              // Pass through or normalize
              const lines = chunk.split('\n');
              for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                  try {
                    const data = JSON.parse(line.slice(6));
                    const text = data.response;
                    if (text) {
                      // Re-package for our UI
                      const packet = `data: ${JSON.stringify({
                        token: text,
                        provider: selectedModel
                      })}\n\n`;
                      await writer.write(encoder.encode(packet));
                    }
                  } catch (e) { }
                }
              }
            }
          } finally {
            await writer.close();
          }
        })());

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'X-AI-Provider': selectedModel,
            ...corsHeaders
          }
        });
      }

    } catch (e: any) {
      return new Response(`Chat Error: ${e.message}`, { status: 500, headers: corsHeaders });
    }
  }
  return new Response('AI Binding Missing', { status: 500, headers: corsHeaders });
}

// ----------------------------------------------------------------------------
// Explain code (Multi-Model)
// ----------------------------------------------------------------------------
async function handleExplain(request: Request, env: Env, ctx: ExecutionContext, corsHeaders: any): Promise<Response> {
  // Explain is complex, stick to Reasoning model if possible, or Default
  const { code, language } = await request.json() as any;
  const model = MODELS.DEFAULT; // Fast explanation

  // ... Implementation similar to handleChat
  try {
    // @ts-ignore
    const response = await env.AI.run(model, {
      prompt: `Explain this ${language} code:\n${code}`,
      max_tokens: 512
    });
    // @ts-ignore
    return json({ explanation: response.response, provider: 'llama-3.3' }, 200, corsHeaders);
  } catch (e: any) {
    return json({ error: e.message }, 500, corsHeaders);
  }
}

// ----------------------------------------------------------------------------
// Filesystem Handler (R2)
// ----------------------------------------------------------------------------
const WORKSPACE_PREFIX = 'projects/default/';

async function handleFilesystem(request: Request, env: Env, corsHeaders: any): Promise<Response> {
  const url = new URL(request.url);

  // List Files
  if (request.method === 'GET' && url.pathname === '/api/fs/list') {
    try {
      const list = await env.R2_ASSETS.list({ prefix: WORKSPACE_PREFIX });
      let files = list.objects.map(o => ({
        name: o.key.replace(WORKSPACE_PREFIX, ''),
        size: o.size,
        uploaded: o.uploaded
      })).filter(f => f.name !== '');

      if (files.length === 0) {
        // Init default for clarity
        files = [{ name: 'readme.md', size: 0, uploaded: new Date() }];
      }
      return json(files, 200, corsHeaders);
    } catch (e: any) {
      return new Response(e.message, { status: 500, headers: corsHeaders });
    }
  }

  // Get File
  if (request.method === 'GET' && url.pathname === '/api/fs/file') {
    const name = url.searchParams.get('name');
    if (!name) return new Response('Missing name', { status: 400, headers: corsHeaders });

    const obj = await env.R2_ASSETS.get(WORKSPACE_PREFIX + name);
    if (!obj) return new Response('Not found', { status: 404, headers: corsHeaders });

    // Determine content type (Primitive)
    const isBinary = name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.glb');

    if (isBinary) {
      // Serve binary directly for browser download/display
      const headers = { ...corsHeaders };
      obj.writeHttpMetadata(headers as any);
      return new Response(obj.body, { headers });
    } else {
      // Text for editor
      const text = await obj.text();
      return json({ content: text }, 200, corsHeaders);
    }
  }

  // Save File
  if (request.method === 'POST' && url.pathname === '/api/fs/file') {
    const { name, content, encoding } = await request.json() as any;

    let body: any = content;

    // Handle Base64 uploads (from Image Gen)
    if (encoding === 'base64') {
      const binString = atob(content);
      body = Uint8Array.from(binString, c => c.charCodeAt(0));
    }

    await env.R2_ASSETS.put(WORKSPACE_PREFIX + name, body);
    return json({ success: true }, 200, corsHeaders);
  }

  return new Response('FS Method Not Allowed', { status: 405, headers: corsHeaders });
}

function json(data: any, status = 200, corsHeaders: any = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}
