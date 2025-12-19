import { Ai } from '@cloudflare/ai';
import Cloudflare from 'cloudflare';
import { UI_JS } from './ui.js';

export interface Env {
  CACHE: KVNamespace;
  MEMORY: KVNamespace;
  R2_ASSETS: R2Bucket;
  AI: Ai;
  RATE_LIMITER: DurableObjectNamespace;

  // Secrets
  GEMINI_API_KEY?: string;
  OLLAMA_URL?: string;
  OLLAMA_AUTH_TOKEN?: string;
  OLLAMA_API_KEY?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  WORKERS_AI_KEY?: string;

  // Public Vars
  MAX_FILE_SIZE: number;
  MAX_CACHE_SIZE: number;
  KV_BATCH_SIZE: number;
  RATE_LIMIT_PER_MINUTE: number;
}

// Durable Object: Rate limiting only
export class RateLimiter {
  state: DurableObjectState;
  requests: Map<string, number[]> = new Map();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const { clientId, limit, window } = await request.json() as any;
    const now = Date.now();
    const windowStart = now - window;

    let times = this.requests.get(clientId) || [];
    times = times.filter(t => t > windowStart);

    if (times.length >= limit) {
      return new Response(JSON.stringify({
        allowed: false,
        retryAfter: Math.ceil((times[0] - windowStart) / 1000)
      }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }

    times.push(now);
    this.requests.set(clientId, times);

    return new Response(JSON.stringify({ allowed: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
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
To edit files, output a code block with the first line specifying the file path:
\`\`\`language
// file: path/to/file.ext
... code ...
\`\`\`
Always specify the full relative path.
Output JSON tool calls wrapped in \`\`\`json blocks only if asked specific questions about filesystem data.
For edits, prefer providing the code block directly.
`;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-AI-Provider, X-AI-Cost',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // --- PRODUCTION HARDENING: Rate Limiting ---
    const clientId = request.headers.get('cf-connecting-ip') || 'unknown';
    const rateLimiterId = env.RATE_LIMITER.idFromName('global');
    const rateLimiter = env.RATE_LIMITER.get(rateLimiterId);

    const rateCheck = await rateLimiter.fetch('https://rate-limit', {
      method: 'POST',
      body: JSON.stringify({
        clientId,
        limit: env.RATE_LIMIT_PER_MINUTE || 15,
        window: 60000
      })
    });

    if (rateCheck.status === 429) {
      const data = await rateCheck.json() as any;
      return new Response(`Rate limit exceeded. Retry in ${data.retryAfter}s`, {
        status: 429,
        headers: { ...corsHeaders, 'Retry-After': String(data.retryAfter) }
      });
    }

    // --- PRODUCTION HARDENING: KV Quota Logic ---
    const today = new Date().toISOString().split('T')[0];
    const writeCount = await env.CACHE.get(`kvWriteCount:${today}`) || '0';
    const isWriteRequest = request.method === 'POST' || request.method === 'PUT' || request.method === 'DELETE';

    // Hard cap check (only for AI/Metadata writes, we allow critical UI/Auth if needed, but here we cap everything to be safe)
    if (isWriteRequest && parseInt(writeCount) >= 1000) {
      // We allow some critical paths if they don't use KV writes, but generally, we warn
      if (url.pathname.startsWith('/api/fs') || url.pathname.startsWith('/api/chat')) {
        return json({ error: "Daily KV write quota exceeded (1000/day). Switch to Ollama local mode." }, 429, corsHeaders);
      }
    }

    // Router
    try {
      if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/ide') {
        const { IDE_HTML } = await import('./ui');
        const { BRIDGE_INTEGRATION } = await import('./ui-bridge');
        const finalHtml = IDE_HTML.replace(
          '</body>',
          '<script type="module">\n' + UI_JS + '\n' + BRIDGE_INTEGRATION + '\n</script>\n</body>'
        );
        return new Response(finalHtml, {
          headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      if (url.pathname === '/ui.js') {
        const { UI_JS } = await import('./ui');
        const { BRIDGE_INTEGRATION } = await import('./ui-bridge');
        return new Response(UI_JS + '\n' + BRIDGE_INTEGRATION, {
          headers: { ...corsHeaders, 'Content-Type': 'application/javascript; charset=utf-8' }
        });
      }

      switch (url.pathname) {
        case '/api/complete':
          return handleComplete(request, env, ctx, corsHeaders);
        case '/api/explain':
          return handleExplain(request, env, ctx, corsHeaders);
        case '/api/chat':
          return handleChat(request, env, ctx, corsHeaders);
        case '/api/image':
          return handleImage(request, env, ctx, corsHeaders);
        case '/api/fs/list':
        case '/api/fs/file':
          return handleFilesystem(request, env, corsHeaders);
        case '/api/terminal':
          return handleTerminal(request, env, corsHeaders);
        case '/api/github/clone':
        case '/api/github/push':
        case '/api/github/user':
        case '/api/github/content':
          return handleGithub(request, env, corsHeaders);
        case '/api/context/map':
          return handleContextMap(request, env, corsHeaders);
        case '/api/health':
          return handleHealth(request, env, corsHeaders);
        default:
          return new Response('Not Found', { status: 404, headers: corsHeaders });
      }
    } catch (e: any) {
      // PRODUCTION HARDENING: Redact secrets from error logs
      const safeMessage = e.message.replace(/GEMINI_API_KEY|OLLAMA_AUTH_TOKEN|AIza[A-Za-z0-9_-]+/g, '[REDACTED]');
      return new Response(`Server Error: ${safeMessage}`, { status: 500, headers: corsHeaders });
    }
  }
};

// ----------------------------------------------------------------------------
// Context / RAG Handler
// ----------------------------------------------------------------------------
async function handleContextMap(request: Request, env: Env, corsHeaders: any): Promise<Response> {
  try {
    const listed = await env.R2_ASSETS.list();
    // Simple context map: list of files.
    // In a real RAG, we'd add token counts or summary signatures here.
    const files = listed.objects.map(o => ({
      name: o.key,
      size: o.size,
      updated: o.uploaded
    }));

    // Filter out binary/useless files for LLM context
    const textFiles = files.filter(f => !f.name.match(/\.(png|jpg|glb|gltf|woff2)$/i));

    return json({ tree: textFiles }, 200, corsHeaders);
  } catch (e: any) {
    return json({ error: e.message }, 500, corsHeaders);
  }
}

// ----------------------------------------------------------------------------
// Terminal & GitHub Handlers
// ----------------------------------------------------------------------------

import { GitHubService } from './services/github';

async function handleTerminal(request: Request, env: Env, corsHeaders: any): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  const { command } = await request.json() as any;
  const args = command.trim().split(/\s+/);
  const cmd = args[0];
  const target = args[1];

  let output = '';

  try {
    switch (cmd) {
      case 'ls':
        const listed = await env.R2_ASSETS.list();
        output = listed.objects.map(o => o.key).join('\n');
        break;
      case 'cat':
        if (!target) { output = 'Usage: cat <filename>'; break; }
        const file = await env.R2_ASSETS.get(target);
        if (!file) output = `File not found: ${target}`;
        else output = await file.text();
        break;
      case 'rm':
        if (!target) { output = 'Usage: rm <filename>'; break; }
        await env.R2_ASSETS.delete(target);
        output = `Deleted ${target}`;
        break;
      case 'echo':
        output = args.slice(1).join(' ');
        break;
      default:
        output = `Command not found: ${cmd}. Try: ls, cat, rm, echo`;
    }
  } catch (e: any) {
    output = `Error: ${e.message}`;
  }

  return json({ output }, 200, corsHeaders);
}

async function handleGithub(request: Request, env: Env, corsHeaders: any): Promise<Response> {
  const url = new URL(request.url);
  // Pass empty strings as we are using Token-auth methods mostly
  const gh = new GitHubService('', '');

  try {
    const body = await request.json() as any;
    const { token, owner, repo, branch, path } = body;

    if (url.pathname.endsWith('/user')) {
      const user = await gh.getUser(token);
      return json(user, 200, corsHeaders);
    }

    if (url.pathname.endsWith('/clone')) {
      // "Clone" here means list files and returning them to UI to "save" to R2
      // A real recursive clone might be too heavy for one request, but let's try shallow or simple
      const tree = await gh.getTree(token, owner, repo, branch || 'main') as any;
      if (tree.truncated) {
        return json({ error: 'Repo too large (truncated)' }, 400, corsHeaders);
      }

      // Filter for blobs (files)
      const files = tree.tree.filter((t: any) => t.type === 'blob');

      // We return the file list. The UI should then fetch content for them or we do it here?
      // Doing it here matches "Clone" better but might timeout.
      // Let's return the tree and let the UI fetch contents or we fetch a few critical ones.
      return json({ files }, 200, corsHeaders);
    }

    // Fetch specific file content from GH (used by Clone loop)
    if (url.pathname.endsWith('/content')) {
      const content = await gh.getRepoContent(token, owner, repo, path);
      // GH returns base64 content often
      return json(content, 200, corsHeaders);
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });

  } catch (e: any) {
    return new Response(`GitHub Error: ${e.message}`, { status: 500, headers: corsHeaders });
  }
}

// Helper (Reuse existing if available, or keep this one if unique)
function info(msg: string) { console.log(msg); }

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
  await env.CACHE.put(`kvWriteCount:${today}`, (count + 1).toString(), { expirationTtl: 86400 });
}

async function handleHealth(request: Request, env: Env, corsHeaders: any): Promise<Response> {
  const status: any = {
    status: 'healthy',
    kvWriteQuota: 0,
    providers: [] as any[]
  };

  // Quota Analytics
  const today = new Date().toISOString().split('T')[0];
  const writeCount = await env.CACHE.get(`kvWriteCount:${today}`) || '0';
  status.kvWriteQuota = Math.round((parseInt(writeCount) / 1000) * 100);

  // Gemini Check
  if (env.GEMINI_API_KEY) {
    const isFailing = await env.CACHE.get('geminiCircuitBreaker') === 'true';
    status.providers.push({
      name: 'gemini',
      tier: 'primary',
      status: isFailing ? 'circuit_open' : 'available',
      free: true
    });
  }

  // Workers AI (Llama)
  if (env.AI) {
    status.providers.push({
      name: 'workers-ai',
      tier: 'secondary',
      status: 'available',
      free: true
    });
  }

  // Ollama
  if (env.OLLAMA_URL) {
    status.providers.push({
      name: 'ollama',
      tier: 'fallback',
      status: 'available',
      free: true
    });
  }

  return json(status, 200, corsHeaders);
}

// ----------------------------------------------------------------------------
// AI Common Core: generateCompletion (Priority Fallback logic)
// ----------------------------------------------------------------------------
async function generateCompletion(env: Env, prompt: string, maxTokens: number): Promise<{ completion: string, provider: string }> {
  // 1. Gemini Flash (Primary)
  const geminiFailing = await env.CACHE.get('geminiCircuitBreaker') === 'true';

  if (!geminiFailing && env.GEMINI_API_KEY) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens }
          }),
          signal: AbortSignal.timeout(15000)
        }
      );

      if (res.ok) {
        const data = await res.json() as any;
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return { completion: text.trim(), provider: 'gemini' };
      }
    } catch (e) {
      await env.CACHE.put('geminiCircuitBreaker', 'true', { expirationTtl: 300 });
    }
  }

  // 2. Workers AI (Secondary Fallback)
  if (env.AI) {
    try {
      // @ts-ignore
      const response = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        prompt,
        max_tokens: maxTokens
      });
      // @ts-ignore
      if (response && response.response) {
        // @ts-ignore
        return { completion: response.response.trim(), provider: 'workers-ai' };
      }
    } catch (e) { }
  }

  // 3. Ollama (Local Fallback)
  if (env.OLLAMA_URL) {
    try {
      const auth = env.OLLAMA_AUTH_TOKEN || env.OLLAMA_API_KEY;
      const res = await fetch(`${env.OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(auth ? { 'Authorization': `Bearer ${auth}` } : {})
        },
        body: JSON.stringify({
          model: 'qwen2.5-coder:7b',
          prompt,
          stream: false,
          options: { num_predict: maxTokens }
        }),
        signal: AbortSignal.timeout(30000)
      });

      if (res.ok) {
        const data = await res.json() as any;
        if (data.response) return { completion: data.response.trim(), provider: 'ollama' };
      }
    } catch (e) { }
  }

  throw new Error('All AI providers failed. Check logs/keys.');
}

// ----------------------------------------------------------------------------
// AI Completion (Unified)
// ----------------------------------------------------------------------------
async function handleComplete(request: Request, env: Env, ctx: ExecutionContext, corsHeaders: any): Promise<Response> {
  const { fileId, code, cursor, language, prompt, model } = await request.json() as any;

  // Use deepseek if explicitly requested, otherwise use unified fallback
  if (model === 'thinking' && env.AI) {
    const stream: any = await (env.AI as any).run(MODELS.REASONING, {
      prompt: prompt || `Complete this ${language} code:\n${code}`,
      max_tokens: 1024
    }, { returnRawResponse: true });
    return new Response(stream, { headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'X-AI-Provider': 'deepseek-r1' } });
  }

  // Normal path: Gemini -> Workers AI -> Ollama
  const before = code ? code.substring(Math.max(0, cursor - 1500), cursor) : '';
  const after = code ? code.substring(cursor, Math.min(code.length, cursor + 500)) : '';
  const finalPrompt = prompt || `Complete this ${language} code:\n${before}<CURSOR>${after}\n\nOutput ONLY the completion:`;

  try {
    const result = await generateCompletion(env, finalPrompt, 256);

    // Quota increment if success
    ctx.waitUntil(incrementKVQuota(env));

    // Return as stream-compatible for UI
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: result.completion, provider: result.provider })}\n\n`));
        controller.close();
      }
    });
    return new Response(stream, { headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' } });
  } catch (e: any) {
    return new Response(`AI Error: ${e.message}`, { status: 500, headers: corsHeaders });
  }
}

// ----------------------------------------------------------------------------
// Chat (Hardened)
// ----------------------------------------------------------------------------
async function handleChat(request: Request, env: Env, ctx: ExecutionContext, corsHeaders: any): Promise<Response> {
  const { message, history = [], model } = await request.json() as any;

  // Use generateCompletion for unified logic
  const prompt = `Chat History:\n${history.map((m: any) => `${m.role}: ${m.content}`).join('\n')}\nUser: ${message}\nAI:`;

  try {
    const result = await generateCompletion(env, prompt, 1024);
    ctx.waitUntil(incrementKVQuota(env));

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: result.completion, provider: result.provider })}\n\n`));
        controller.close();
      }
    });

    return new Response(stream, { headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' } });
  } catch (e: any) {
    return new Response(`Chat Error: ${e.message}`, { status: 500, headers: corsHeaders });
  }
}

// ----------------------------------------------------------------------------
// Explain code (Multi-Model)
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// Explain Code (Hardened)
// ----------------------------------------------------------------------------
async function handleExplain(request: Request, env: Env, ctx: ExecutionContext, corsHeaders: any): Promise<Response> {
  const { code, language } = await request.json() as any;
  const prompt = `Explain this ${language} code concisely:\n\`\`\`${language}\n${code}\n\`\`\`\n\nExplanation:`;

  try {
    const result = await generateCompletion(env, prompt, 512);
    ctx.waitUntil(incrementKVQuota(env));
    return json({ explanation: result.completion, provider: result.provider }, 200, corsHeaders);
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

  // Delete File
  if (request.method === 'DELETE' && url.pathname === '/api/fs/file') {
    const { name } = await request.json() as { name: string };
    if (!name) return new Response('Missing name', { status: 400 });
    await env.R2_ASSETS.delete(WORKSPACE_PREFIX + name);
    return new Response('Deleted', { status: 200 });
  }

  return new Response('FS Method Not Allowed', { status: 405, headers: corsHeaders });
}

function json(data: any, status = 200, corsHeaders: any = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}
