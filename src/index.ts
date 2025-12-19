import { Ai } from '@cloudflare/ai';
import Cloudflare from 'cloudflare';
import { IDE_HTML, UI_JS } from './ui-new';
import { BRIDGE_INTEGRATION } from './ui-bridge';

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
  DISPATCHER?: any;

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
  // Text / Coding / Reasoning
  DEFAULT: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  REASONING: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
  CODING: '@cf/qwen/qwen2.5-coder-32b-instruct',
  GPT_OSS: '@cf/openai/gpt-oss-120b',
  Llama4_SCOUT: '@cf/meta/llama-4-scout-17b-16e-instruct',

  // Image Gen (Enhanced List)
  FLUX: '@cf/black-forest-labs/flux-1-schnell',
  FLUX_DEV: '@cf/black-forest-labs/flux-2-dev',
  SDXL: '@cf/bytedance/stable-diffusion-xl-lightning',
  DREAMSHAPER: '@cf/lykon/dreamshaper-8-lcm',
  LUCID: '@cf/leonardo/lucid-origin',
  PHOENIX: '@cf/leonardo/phoenix-1.0',

  // Audio (Hands-Free)
  STT: '@cf/openai/whisper-large-v3-turbo',
  TTS: '@cf/myshell-ai/melotts',
  AURA: '@cf/deepgram/aura-2-en',

  // Vision
  LLAVA: '@cf/llava-hf/llava-1.5-7b-hf',
  RESNET: '@cf/microsoft/resnet-50'
};

// --- Recommendation 6: Provider Health Tracking ---
class ProviderHealth {
  failures = 0;
  lastSuccess = Date.now();
  private readonly FAILURE_THRESHOLD = 3;
  private readonly RECOVERY_TIME = 300000; // 5 minutes

  recordFailure() { this.failures++; }
  recordSuccess() { this.failures = 0; this.lastSuccess = Date.now(); }
  isHealthy(): boolean {
    if (this.failures >= this.FAILURE_THRESHOLD) {
      return (Date.now() - this.lastSuccess) > this.RECOVERY_TIME;
    }
    return true;
  }
}

const healthTracker = {
  gemini: new ProviderHealth(),
  workersAi: new ProviderHealth(),
  ollama: new ProviderHealth()
};

// --- Recommendation 4: Adaptive Memory Batching ---
let lastMemoryWriteTime = 0;
const MIN_BATCH_DELAY = 60000; // 1 minute

async function saveProjectMemory(env: Env, ctx: ExecutionContext, projectId: string, data: any) {
  const now = Date.now();
  const timeSinceLastWrite = now - lastMemoryWriteTime;

  // Dynamic batch size: More aggressive during peak hours (9-17)
  const hour = new Date().getHours();
  const batchThreshold = (hour >= 9 && hour <= 17) ? 15 : 10;

  // Simple completion counter stored in KV (volatile is fine here)
  const countKey = `memBatch:${projectId}`;
  const count = parseInt(await env.CACHE.get(countKey) || '0') + 1;

  const shouldWriteToKV = (count % batchThreshold === 0) || (timeSinceLastWrite > MIN_BATCH_DELAY);

  if (shouldWriteToKV) {
    ctx.waitUntil(env.MEMORY.put(`project:${projectId}`, JSON.stringify(data)));
    ctx.waitUntil(env.CACHE.put(countKey, '0'));
    lastMemoryWriteTime = now;
  } else {
    ctx.waitUntil(env.CACHE.put(countKey, count.toString()));
  }
}

const SYSTEM_PROMPT = `
You are an advanced AI coding agent (Omni-Dev Level).
Primary Directive: Provide immediate, actionable, and correct code or answers.
- Keep responses snappy and concise.
- Minimize "thinking out loud" unless using the reasoning model.
- Avoid repetitive reasoning loops. If you find yourself over-speculating, stop and ask for data.
- Do not assume files exist unless you see them in the file list.
- To edit files, output a code block with the first line specifying the file path:
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

    // --- Recommendation 3: Smart KV Quota Management ---
    const QUOTA_WARNING_THRESHOLD = 0.85;
    const QUOTA_HARD_THRESHOLD = 0.95;

    const today = new Date().toISOString().split('T')[0];
    const writeCountRaw = await env.CACHE.get(`kvWriteCount:${today}`) || '0';
    const writeCount = parseInt(writeCountRaw);
    const quota = writeCount / 1000;

    const isWriteRequest = request.method === 'POST' || request.method === 'PUT' || request.method === 'DELETE';

    if (quota > QUOTA_HARD_THRESHOLD && isWriteRequest) {
      if (url.pathname.startsWith('/api/fs') || url.pathname.startsWith('/api/chat')) {
        return json({
          error: `KV quota critical: ${1000 - writeCount} writes remaining. Switching to read-only mode.`,
          suggestion: "Use Ollama local mode"
        }, 429, corsHeaders);
      }
    }

    // Router
    try {
      if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/ide') {
        const finalHtml = IDE_HTML.replace(
          '</body>',
          '<script type="module">\n' + UI_JS + '\n' + BRIDGE_INTEGRATION + '\n// v=HOLD_FIX_V5 - BUILD: ' + Date.now() + '\n</script>\n</body>'
        );
        return new Response(finalHtml, {
          headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      if (url.pathname === '/ui.js') {
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
        case '/api/audio/stt':
          return handleAudioSTT(request, env, corsHeaders);
        case '/api/audio/tts':
          return handleAudioTTS(request, env, corsHeaders);
        case '/api/deploy':
          return handleDeploy(request, env, corsHeaders);
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
        namespaceName: "code-agent-dispatcher",
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
// Image Generation Runner (Hardened with R2 Persistence)
// ----------------------------------------------------------------------------
async function handleImage(request: Request, env: Env, ctx: ExecutionContext, corsHeaders: any): Promise<Response> {
  if (!env.AI) return new Response('Workers AI binding missing', { status: 500, headers: corsHeaders });

  const { prompt, style } = await request.json() as any;
  if (!prompt) return new Response('Missing prompt', { status: 400, headers: corsHeaders });

  try {
    let modelId = MODELS.FLUX;
    if (style === 'realism') modelId = MODELS.SDXL;
    if (style === 'artistic') modelId = MODELS.DREAMSHAPER;
    if (style === 'high-res') modelId = MODELS.FLUX_DEV;
    if (style === 'lucid') modelId = MODELS.LUCID;
    if (style === 'phoenix') modelId = MODELS.PHOENIX;

    // @ts-ignore
    const result = await env.AI.run(modelId, { prompt });

    const arrayBuffer = await new Response(result as any).arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const filename = `generated_${Date.now()}.png`;
    await env.R2_ASSETS.put(WORKSPACE_PREFIX + filename, arrayBuffer, {
      httpMetadata: { contentType: 'image/png' }
    });

    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.byteLength; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength)));
    }
    const base64 = btoa(binary);

    return json({
      image: `data:image/png;base64,${base64}`,
      filename,
      provider: modelId
    }, 200, corsHeaders);
  } catch (e: any) {
    return new Response(`Art Gen Failed: ${e.message}`, { status: 500, headers: corsHeaders });
  }
}

// ----------------------------------------------------------------------------
// Audio Handlers (Hands-Free Interaction)
// ----------------------------------------------------------------------------

async function handleAudioSTT(request: Request, env: Env, corsHeaders: any): Promise<Response> {
  if (!env.AI) return new Response('AI binding missing', { status: 500, headers: corsHeaders });

  try {
    const audioBuffer = await request.arrayBuffer();
    const audioArray = new Uint8Array(audioBuffer);

    try {
      // Direct binary input for Whisper is the most reliable current method in Workers AI
      // @ts-ignore
      const response = await env.AI.run(MODELS.STT, audioArray);
      return json(response, 200, corsHeaders);
    } catch (e1: any) {
      try {
        // Fallback: Number array format
        // @ts-ignore
        const response = await env.AI.run(MODELS.STT, {
          audio: Array.from(audioArray)
        });
        return json(response, 200, corsHeaders);
      } catch (e2: any) {
        return new Response(`STT Error: [Direct: ${e1.message}] [Array: ${e2.message}]`, { status: 500, headers: corsHeaders });
      }
    }
  } catch (e: any) {
    return new Response(`STT Buffer Error: ${e.message}`, { status: 500, headers: corsHeaders });
  }
}

async function handleAudioTTS(request: Request, env: Env, corsHeaders: any): Promise<Response> {
  if (!env.AI) return new Response('AI binding missing', { status: 500, headers: corsHeaders });

  const { text } = await request.json() as any;
  if (!text) return new Response('Missing text', { status: 400, headers: corsHeaders });

  try {
    // @ts-ignore
    const response = await env.AI.run(MODELS.TTS, { text });

    // Return raw audio binary (MP3)
    return new Response(response as any, {
      headers: { ...corsHeaders, 'Content-Type': 'audio/mpeg' }
    });
  } catch (e: any) {
    return new Response(`TTS Error: ${e.message}`, { status: 500, headers: corsHeaders });
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

async function generateCompletion(env: Env, prompt: string, maxTokens: number, requestedModel?: string, temperature = 0.2): Promise<{ completion: string, provider: string }> {
  const providers = [
    {
      name: 'gemini',
      check: !!env.GEMINI_API_KEY,
      health: healthTracker.gemini,
      run: async () => {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature, maxOutputTokens: maxTokens }
            }),
            signal: AbortSignal.timeout(15000)
          }
        );
        if (!res.ok) throw new Error('Gemini HTTP ' + res.status);
        const data = await res.json() as any;
        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      }
    },
    {
      name: 'workers-ai',
      check: !!env.AI,
      health: healthTracker.workersAi,
      run: async () => {
        let modelId = MODELS.DEFAULT;
        if (requestedModel === 'thinking') modelId = MODELS.REASONING;
        if (requestedModel === 'coding') modelId = MODELS.CODING;
        if (requestedModel === 'gpt-oss') modelId = MODELS.GPT_OSS;

        // @ts-ignore
        const response = await env.AI.run(modelId, { prompt, max_tokens: maxTokens, temperature });
        // @ts-ignore
        return response.response?.trim();
      }
    },
    {
      name: 'ollama',
      check: !!env.OLLAMA_URL,
      health: healthTracker.ollama,
      run: async () => {
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
        if (!res.ok) throw new Error('Ollama HTTP ' + res.status);
        const data = await res.json() as any;
        return data.response?.trim();
      }
    }
  ];

  // If a specific model is requested, we prefer Workers AI if healthy
  if (requestedModel && requestedModel !== 'auto' && providers[1].health.isHealthy()) {
    try {
      const completion = await providers[1].run();
      if (completion) {
        providers[1].health.recordSuccess();
        return { completion, provider: 'workers-ai' };
      }
    } catch (e) {
      providers[1].health.recordFailure();
    }
  }

  // Fallback chain based on health
  for (const provider of providers) {
    if (provider.check && provider.health.isHealthy()) {
      try {
        const completion = await provider.run();
        if (completion) {
          provider.health.recordSuccess();
          return { completion, provider: provider.name };
        }
      } catch (e) {
        provider.health.recordFailure();
        console.warn(`${provider.name} failed:`, e);
      }
    }
  }

  throw new Error('All AI providers failed or unhealthy.');
}

// ----------------------------------------------------------------------------
// AI Completion (Unified)
// ----------------------------------------------------------------------------
async function handleComplete(request: Request, env: Env, ctx: ExecutionContext, corsHeaders: any): Promise<Response> {
  const { fileId, code, cursor, language, prompt, model } = await request.json() as any;

  // Normal path: Unified generateCompletion handles logic/model routing
  const before = code ? code.substring(Math.max(0, cursor - 1500), cursor) : '';
  const after = code ? code.substring(cursor, Math.min(code.length, cursor + 500)) : '';
  const finalPrompt = prompt || `Complete this ${language} code:\n${before}<CURSOR>${after}\n\nOutput ONLY the completion:`;

  try {
    const result = await generateCompletion(env, finalPrompt, 256, model, 0.1);

    // Recommendation 4: Adaptive Memory Batching
    ctx.waitUntil(saveProjectMemory(env, ctx, 'default', {
      lastPrompt: finalPrompt,
      lastResult: result.completion,
      timestamp: Date.now()
    }));

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
    const result = await generateCompletion(env, prompt, 1024, model, 0.3);

    // Recommendation 4: Adaptive Memory Batching
    ctx.waitUntil(saveProjectMemory(env, ctx, 'default', {
      lastMessage: message,
      lastResponse: result.completion,
      timestamp: Date.now()
    }));

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
    const result = await generateCompletion(env, prompt, 512, 'coding', 0);
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
    const isBinary = name.match(/\.(png|jpg|jpeg|glb|gltf|gif|webp)$/i);

    if (isBinary) {
      // Serve binary directly for browser download/display
      const headers = new Headers(corsHeaders);
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
