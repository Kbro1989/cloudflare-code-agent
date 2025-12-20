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
  VITE_GEMINI_API_KEY?: string;
  OLLAMA_URL?: string;
  OLLAMA_AUTH_TOKEN?: string;
  OLLAMA_API_KEY?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  WORKERS_AI_KEY?: string;
  FIREWORKS_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  HUGGINGFACE_API_KEY?: string;
  DISPATCHER?: any;

  // Public Vars
  MAX_FILE_SIZE: number;
  MAX_CACHE_SIZE: number;
  KV_BATCH_SIZE: number;
  RATE_LIMIT_PER_MINUTE: number;
  AI_GATEWAY_ID: string;
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
  // --- High-Performance Reasoning & Production ---
  GPT_OSS: '@cf/openai/gpt-oss-120b',
  LLAMA4_SCOUT: '@cf/meta/llama-4-scout-17b-16e-instruct',
  REASONING: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
  QWQ_32B: '@cf/qwen/qwq-32b',

  // --- Standard Logic & Coding ---
  DEFAULT: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  CODING: '@cf/qwen/qwen2.5-coder-32b-instruct',
  DEEPSEEK_CODER: '@cf/thebloke/deepseek-coder-6.7b-instruct-awq',
  MISTRAL_SMALL: '@cf/mistralai/mistral-small-3.1-24b-instruct',
  GEMMA_3: '@cf/google/gemma-3-12b-it',
  QWEN3_30B: '@cf/qwen/qwen3-30b-a3b-fp8',

  // --- External Elite (API-driven) ---
  KIMI: 'fireworks/kimi-k1.5',
  GPT4O: 'openrouter/openai/gpt-4o',
  CLAUDE3: 'openrouter/anthropic/claude-3.5-sonnet',

  // --- Visual Arts (Image Generation) ---
  FLUX_DEV: '@cf/black-forest-labs/flux-2-dev',
  FLUX: '@cf/black-forest-labs/flux-1-schnell',
  SDXL: '@cf/bytedance/stable-diffusion-xl-lightning',
  DREAMSHAPER: '@cf/lykon/dreamshaper-8-lcm',
  LUCID: '@cf/leonardo/lucid-origin',
  PHOENIX: '@cf/leonardo/phoenix-1.0',

  // --- Audio Pipeline ---
  STT: '@cf/openai/whisper-large-v3-turbo',
  TTS: '@cf/myshell-ai/melotts',
  AURA: '@cf/deepgram/aura-2-en',
  AURA_ES: '@cf/deepgram/aura-2-es',

  // --- Vision & Perception ---
  LLAVA: '@cf/llava-hf/llava-1.5-7b-hf',
  RESNET: '@cf/microsoft/resnet-50'
};

const MODEL_GROUPS = [
  { name: 'Elite Reasoning', models: ['GPT_OSS', 'LLAMA4_SCOUT', 'REASONING', 'QWQ_32B'] },
  { name: 'Coding & Logic', models: ['CODING', 'DEEPSEEK_CODER', 'DEFAULT', 'MISTRAL_SMALL', 'GEMMA_3'] },
  { name: 'External Elite', models: ['KIMI', 'GPT4O', 'CLAUDE3'] },
  { name: 'Visual Studio', models: ['FLUX_DEV', 'FLUX', 'SDXL', 'LUCID', 'PHOENIX'] },
  { name: 'Audio & Vision', models: ['AURA', 'STT', 'TTS', 'LLAVA'] }
];

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
  ollama: new ProviderHealth(),
  fireworks: new ProviderHealth(),
  openrouter: new ProviderHealth()
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

async function runAI(env: Env, model: string, input: any, provider = 'workers-ai'): Promise<any> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const gatewayId = env.AI_GATEWAY_ID;
  const cfApiToken = env.WORKERS_AI_KEY || env.CLOUDFLARE_API_TOKEN;
  const geminiApiKey = env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY;

  // --- BYPASS GATEWAY FOR BINARY-HEAVY MODELS (Performance & Reliability) ---
  const isBinaryModel = model.includes('whisper') || model.includes('melo') || model.includes('aura') || model.includes('flux') || model.includes('stable-diffusion') || model.includes('resnet');

  if (isBinaryModel && provider === 'workers-ai' && env.AI) {
    try {
      return await env.AI.run(model as any, input);
    } catch (e) {
      console.warn(`Direct AI (${model}) failed. Trying Gateway as fallback...`);
    }
  }

  if (accountId && gatewayId && cfApiToken) {
    try {
      const providers: Record<string, string> = {
        'workers-ai': 'workers-ai',
        'gemini': 'google-ai-studio'
      };

      const mappedProvider = providers[provider] || provider;
      let url = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/${mappedProvider}`;

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${cfApiToken}`,
        'Content-Type': 'application/json'
      };

      if (provider === 'gemini') {
        url += `/v1/models/${model}`;
        if (geminiApiKey) headers['x-goog-api-key'] = geminiApiKey;
      } else {
        url += `/${model}`;
      }

      // JSON body only for text models, unless it's a binary instance
      let body;
      if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
        body = input;
        headers['Content-Type'] = 'application/octet-stream';
      } else if (input.audio && (input.audio instanceof Uint8Array || input.audio instanceof ArrayBuffer)) {
        // Direct mapping for Workers AI / Gateway pattern that expects binary
        body = input.audio;
        headers['Content-Type'] = 'application/octet-stream';
      } else {
        body = JSON.stringify(input);
      }

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: body as any,
        signal: AbortSignal.timeout(30000)
      });

      if (res.ok) {
        const data = await res.json() as any;
        return data.result || data;
      }
      const errorBody = await res.text();
      throw new Error(`Gateway Error (${res.status}): ${errorBody}`);
    } catch (e: any) {
      console.error(`Gateway (${provider}) error:`, e.message);
      // If it was the primary provider, let it throw so fallback works
      if (provider !== 'workers-ai') throw e;
    }
  }

  // --- DIRECT FALLBACKS ---
  if (provider === 'workers-ai' && env.AI) {
    return await env.AI.run(model as any, input);
  }

  if (provider === 'gemini' && geminiApiKey) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(30000)
      }
    );
    if (res.ok) return await res.json();
    throw new Error(`Direct Gemini failed: ${res.status}`);
  }

  if (provider === 'fireworks' && env.FIREWORKS_API_KEY) {
    const res = await fetch(`https://api.fireworks.ai/inference/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.FIREWORKS_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model, messages: input.messages || [{ role: 'user', content: input.prompt }], max_tokens: input.max_tokens }),
      signal: AbortSignal.timeout(30000)
    });
    if (res.ok) return await res.json();
  }

  if (provider === 'openrouter' && env.OPENROUTER_API_KEY) {
    const res = await fetch(`https://openrouter.ai/api/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://cloudflare-code-agent.com',
        'X-Title': 'Cloudflare Code Agent'
      },
      body: JSON.stringify({ model, messages: input.messages || [{ role: 'user', content: input.prompt }], max_tokens: input.max_tokens }),
      signal: AbortSignal.timeout(30000)
    });
    if (res.ok) return await res.json();
  }

  throw new Error(`AI call failed (both Gateway and Direct) for ${provider}`);
}

const SYSTEM_PROMPT = `
You are **Nova Core v4**, a high-performance Omni-Dev AI integrated into the Cyan Neon Glow IDE. Your primary objective is to assist the user in building, debugging, and optimizing Cloudflare-powered applications with maximum precision and aesthetic excellence.
Primary Directive: Deliver production-ready code, 3D assets, and architectural decisions.

- **Concision**: Output only what is necessary. No fluff.
- **Voice Mediation**:
    * If a user message starts with \`[VOICE_COMMAND]\`, prioritize a concise, spoken-friendly summary first, then the code/data below it.
    * Act as a bridge: if you generate code, mention it briefly ("I've written the script for you") instead of reading it out.
- **Tools**:
    * [IMAGE: prompt] -> Generate high-fidelity art (FLUX.2 Dev).
    * [BLENDER: script] -> Execute 3D automation.
    * [TERM: cmd] -> Direct terminal access.
    * [SEARCH: pattern] -> Scan codebase for logic.
    * [READ: path] -> Import file context.
    * [GITHUB: push owner/repo:branch:msg] -> Ship to production.
- **Design Pattern**:
    * For new projects ([PROJECT-INIT]), provide a full file tree design, then implement files sequentially.
    * Always verify file contents with [READ] before proposing major refactors.
\`\`\`language
// file: path/to/file.ext
... code ...
\`\`\`
Use [SEARCH] immediately if asked to fix unfamiliar bugs.
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
          `<script type="module" src="/assets/app.js"></script>
           <!-- v=OPTIMIZED_ASSET_V1 - BUILD: ${Date.now()} -->
          </body>`
        );
        return new Response(finalHtml, {
          headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      if (url.pathname === '/assets/app.js') {
        return new Response(UI_JS + "\n" + BRIDGE_INTEGRATION, {
          headers: { ...corsHeaders, 'Content-Type': 'application/javascript; charset=utf-8' }
        });
      }

      if (url.pathname === '/favicon.ico') {
        return new Response(null, { status: 204, headers: corsHeaders });
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
        case '/api/audio/generate':
          return handleAudioGenerate(request, env, corsHeaders);
        case '/api/doctor':
          return handleDoctor(request, env, ctx, corsHeaders);
        case '/api/deploy':
          return handleDeploy(request, env, corsHeaders);
        case '/api/fs/list':
        case '/api/fs/file':
        case '/api/fs/search':
          return handleFilesystem(request, env, ctx, corsHeaders);
        case '/api/terminal':
          return handleTerminal(request, env, ctx, corsHeaders);
        case '/api/github/clone':
        case '/api/github/push':
        case '/api/github/user':
        case '/api/github/content':
          return handleGithub(request, env, ctx, corsHeaders);
        case '/api/context/map':
          return handleContextMap(request, env, corsHeaders);
        case '/api/health':
          return handleHealth(request, env, ctx, corsHeaders);
        case '/api/models':
          return json({ catalog: MODELS, groups: MODEL_GROUPS }, 200, corsHeaders);
        default:
          return new Response('Not Found', { status: 404, headers: corsHeaders });
      }
    } catch (e: any) {
      // PRODUCTION HARDENING: Redact secrets from error logs
      return errorResponse(`Server Error: ${e.message}`, 500, corsHeaders);
    }
  }
};

// ----------------------------------------------------------------------------
// Context / RAG Handler
// ----------------------------------------------------------------------------
async function handleContextMap(request: Request, env: Env, corsHeaders: any): Promise<Response> {
  if (request.method !== 'GET') return errorResponse('Method Not Allowed', 405, corsHeaders);
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
    return errorResponse(e.message, 500, corsHeaders);
  }
}

// ----------------------------------------------------------------------------
// Deployment Handler (Self-Replication)
// ----------------------------------------------------------------------------
async function handleDeploy(request: Request, env: Env, corsHeaders: any): Promise<Response> {
  if (request.method !== 'POST') return errorResponse('Method Not Allowed', 405, corsHeaders);
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID || !env.DISPATCHER) {
    return errorResponse('Deployment secrets missing (API_TOKEN, ACCOUNT_ID, or DISPATCHER)', 500, corsHeaders);
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
    return errorResponse(`Deploy Failed: ${e.message}`, 500, corsHeaders);
  }
}

// ----------------------------------------------------------------------------
// Terminal & GitHub Handlers
// ----------------------------------------------------------------------------

import { GitHubService } from './services/github';

async function handleTerminal(request: Request, env: Env, ctx: ExecutionContext, corsHeaders: any): Promise<Response> {
  if (request.method !== 'POST') return errorResponse('Method Not Allowed', 405, corsHeaders);
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

async function handleGithub(request: Request, env: Env, ctx: ExecutionContext, corsHeaders: any): Promise<Response> {
  if (request.method !== 'POST') return errorResponse('Method Not Allowed', 405, corsHeaders);
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

    // List specific repo content
    if (url.pathname.endsWith('/content')) {
      const content = await gh.getRepoContent(token, owner, repo, path);
      return json(content, 200, corsHeaders);
    }

    if (url.pathname.endsWith('/push')) {
      const { message, branch: targetBranch } = body;
      const b = targetBranch || 'main';

      // 1. Get current branch SHA
      const branchRef: any = await gh.getTree(token, owner, repo, b);
      const baseTreeSha = branchRef.sha;
      const parentSha = branchRef.sha; // This is actually the tree, we need the commit SHA

      // Correctly get head commit SHA
      const head: any = await (gh as any).request(token, `/repos/${owner}/${repo}/git/refs/heads/${b}`);
      const headCommitSha = head.object.sha;
      const headCommit: any = await (gh as any).request(token, `/repos/${owner}/${repo}/git/commits/${headCommitSha}`);
      const currentTreeSha = headCommit.tree.sha;

      // 2. Fetch all files from R2
      const listed = await env.R2_ASSETS.list({ prefix: WORKSPACE_PREFIX });
      const treeItems = [];

      for (const obj of listed.objects) {
        const name = obj.key.replace(WORKSPACE_PREFIX, '');
        if (name === 'BIBLE_TASKS.json' || name === 'BIBLE_LORE.md' || name.match(/\.(ts|js|html|css|json|md|txt)$/i)) {
          const file = await env.R2_ASSETS.get(obj.key);
          if (file) {
            const content = await file.text();
            const blob: any = await gh.createBlob(token, owner, repo, content);
            treeItems.push({
              path: name,
              mode: '100644',
              type: 'blob',
              sha: blob.sha
            });
          }
        }
      }

      // 3. Create Tree
      const newTree: any = await gh.createTree(token, owner, repo, currentTreeSha, treeItems);

      // 4. Create Commit
      const newCommit: any = await gh.createCommit(token, owner, repo, message || 'Final Product Update', newTree.sha, [headCommitSha]);

      // 5. Update Ref
      const result: any = await gh.updateRef(token, owner, repo, `heads/${b}`, newCommit.sha);

      return json({ success: true, sha: result.object.sha }, 200, corsHeaders);
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });

  } catch (e: any) {
    return errorResponse(`GitHub Error: ${e.message}`, 500, corsHeaders);
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
  if (request.method !== 'POST') return errorResponse('Method Not Allowed', 405, corsHeaders);
  if (!env.AI) return errorResponse('Workers AI binding missing', 500, corsHeaders);

  const { prompt, style } = await request.json() as any;
  if (!prompt) return errorResponse('Missing prompt', 400, corsHeaders);

  try {
    let modelId = MODELS.FLUX_DEV; // Default to Dev for high precision
    if (style === 'sdxl') modelId = MODELS.SDXL;
    else if (style === 'lucid') modelId = MODELS.LUCID;
    else if (style === 'phoenix') modelId = MODELS.PHOENIX;
    else if (style === 'flux') modelId = MODELS.FLUX; // schnell

    // @ts-ignore
    const response = await runAI(env, modelId, {
      prompt,
      num_steps: style === 'quality' ? 50 : 20
    });

    const arrayBuffer = await new Response(response as any).arrayBuffer();
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
    return errorResponse(`Art Gen Failed: ${e.message}`, 500, corsHeaders);
  }
}

// ----------------------------------------------------------------------------
// Audio Handlers (Hands-Free Interaction)
// ----------------------------------------------------------------------------

async function handleAudioSTT(request: Request, env: Env, corsHeaders: any): Promise<Response> {
  if (request.method !== 'POST') return errorResponse('Method Not Allowed', 405, corsHeaders);
  if (!env.AI) return errorResponse('AI binding missing', 500, corsHeaders);

  try {
    const audioBuffer = await request.arrayBuffer();
    const audioArray = new Uint8Array(audioBuffer);

    console.log(`🎙️ STT Request: ${audioArray.byteLength} bytes`);

    if (audioArray.byteLength < 100) {
      return new Response('Audio buffer too small', { status: 400, headers: corsHeaders });
    }

    try {
      // 5006 fix: Some models require { audio: binary } vs raw binary
      // We try raw first as it's more efficient, then wrap if it fails with schema error
      let response;
      try {
        response = await runAI(env, MODELS.STT, audioArray);
      } catch (e: any) {
        if (e.message.includes('required properties') || e.message.includes('5006')) {
          // Fallback to array format if binary is rejected
          response = await runAI(env, MODELS.STT, { audio: Array.from(audioArray) });
        } else {
          throw e;
        }
      }
      return json(response, 200, corsHeaders);
    } catch (e1: any) {
      console.error('STT Failure:', e1.message);
      return new Response(`STT Error: ${e1.message}`, { status: 500, headers: corsHeaders });
    }
  } catch (e: any) {
    return errorResponse(`STT Buffer Error: ${e.message}`, 500, corsHeaders);
  }
}

async function handleAudioTTS(request: Request, env: Env, corsHeaders: any): Promise<Response> {
  if (request.method !== 'POST') return errorResponse('Method Not Allowed', 405, corsHeaders);
  if (!env.AI) return errorResponse('AI binding missing', 500, corsHeaders);

  const { text } = await request.json() as any;
  if (!text) return new Response('Missing text', { status: 400, headers: corsHeaders });

  try {
    // @ts-ignore
    const response = await runAI(env, MODELS.TTS, { text });

    // Return raw audio binary (MP3)
    return new Response(response as any, {
      headers: { ...corsHeaders, 'Content-Type': 'audio/mpeg' }
    });
  } catch (e: any) {
    return errorResponse(`TTS Error: ${e.message}`, 500, corsHeaders);
  }
}

async function handleAudioGenerate(request: Request, env: Env, corsHeaders: any): Promise<Response> {
  if (request.method !== 'POST') return errorResponse('Method Not Allowed', 405, corsHeaders);
  const { text, model } = await request.json() as any;
  if (!text) return new Response('Missing text', { status: 400, headers: corsHeaders });

  try {
    const modelId = (model === 'aura') ? MODELS.AURA : MODELS.TTS;
    const response = await runAI(env, modelId, { text });

    // Aura returns an Object with {audio: ...} in some cases or raw binary
    // Melo returns raw binary
    const audioData = response.audio || response;

    return new Response(audioData as any, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'audio/mpeg',
        'X-Audio-Provider': modelId
      }
    });
  } catch (e: any) {
    return errorResponse(`Audio Gen Failed: ${e.message}`, 500, corsHeaders);
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

async function handleHealth(request: Request, env: Env, ctx: ExecutionContext, corsHeaders: any): Promise<Response> {
  if (request.method !== 'GET') return errorResponse('Method Not Allowed', 405, corsHeaders);
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
  if (env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY) {
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
// AI Completion Engine (Structured & Resilient)
// ----------------------------------------------------------------------------
async function generateCompletion(
  env: Env,
  promptOrMessages: string | any[],
  maxTokens = 512,
  requestedModel = 'auto',
  temperature = 0.5
): Promise<{ completion: string, provider: string }> {
  const isMessages = Array.isArray(promptOrMessages);

  const providers = [
    {
      name: 'gemini',
      check: !!(env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY),
      health: healthTracker.gemini,
      run: async () => {
        let contents;
        if (isMessages) {
          contents = promptOrMessages.map(m => ({
            role: m.role === 'assistant' ? 'model' : (m.role === 'system' ? 'user' : m.role),
            parts: [{ text: (m.role === 'system' ? `[SYSTEM INSTRUCTION]\n${m.content}\n[END SYSTEM INSTRUCTION]` : m.content) }]
          }));
        } else {
          contents = [{ parts: [{ text: promptOrMessages }] }];
        }

        const data = await runAI(env, 'gemini-1.5-flash:generateContent', {
          contents,
          generationConfig: { temperature, maxOutputTokens: maxTokens }
        }, 'gemini');
        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      }
    },
    {
      name: 'workers-ai',
      check: !!env.AI,
      health: healthTracker.workersAi,
      run: async () => {
        let modelId = MODELS.DEFAULT;
        if (requestedModel) {
          const upperModel = requestedModel.toUpperCase();
          // @ts-ignore
          if (MODELS[upperModel]) {
            // @ts-ignore
            modelId = MODELS[upperModel];
          } else if (requestedModel === 'thinking' || requestedModel === 'reasoning') {
            modelId = MODELS.REASONING;
          } else if (requestedModel === 'coding') {
            modelId = MODELS.CODING;
          } else if (requestedModel === 'gpt_oss') {
            modelId = MODELS.GPT_OSS;
          } else if (requestedModel === 'llama4_scout') {
            modelId = MODELS.LLAMA4_SCOUT;
          } else if (requestedModel === 'qwq_32b') {
            modelId = MODELS.QWQ_32B;
          } else if (requestedModel === 'mistral_small') {
            modelId = MODELS.MISTRAL_SMALL;
          } else if (requestedModel === 'gemma_3') {
            modelId = MODELS.GEMMA_3;
          } else if (requestedModel === 'deepseek_coder') {
            modelId = MODELS.DEEPSEEK_CODER;
          }
        }

        const input: any = { max_tokens: maxTokens, temperature };
        if (isMessages) {
          input.messages = promptOrMessages;
        } else {
          input.prompt = promptOrMessages;
        }

        const response = await runAI(env, modelId, input);
        if (!response) throw new Error("Empty response from AI");
        const text = (response.response || response.message?.content || (typeof response === 'string' ? response : ''));
        if (!text) throw new Error("Could not extract text from AI response");
        return text.trim();
      }
    },
    {
      name: 'ollama',
      check: !!env.OLLAMA_URL,
      health: healthTracker.ollama,
      run: async () => {
        const auth = env.OLLAMA_AUTH_TOKEN || env.OLLAMA_API_KEY;
        const body: any = {
          model: 'qwen2.5-coder:7b',
          stream: false,
          options: { num_predict: maxTokens }
        };

        if (isMessages) {
          body.messages = promptOrMessages;
        } else {
          body.prompt = promptOrMessages;
        }

        const res = await fetch(`${env.OLLAMA_URL}/api/${isMessages ? 'chat' : 'generate'}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(auth ? { 'Authorization': `Bearer ${auth}` } : {})
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000)
        });
        if (!res.ok) throw new Error('Ollama HTTP ' + res.status);
        const data = await res.json() as any;
        return (isMessages ? data.message?.content : data.response)?.trim();
      }
    },
    {
      name: 'fireworks',
      check: !!env.FIREWORKS_API_KEY,
      health: healthTracker.fireworks,
      run: async () => {
        const modelId = requestedModel === 'kimi' ? MODELS.KIMI : (requestedModel.includes('/') ? requestedModel : MODELS.KIMI);
        const data = await runAI(env, modelId, { max_tokens: maxTokens, temperature }, 'fireworks');
        return data.choices?.[0]?.message?.content?.trim();
      }
    },
    {
      name: 'openrouter',
      check: !!env.OPENROUTER_API_KEY,
      health: healthTracker.openrouter,
      run: async () => {
        let modelId = MODELS.GPT4O;
        if (requestedModel === 'gpt4o') modelId = MODELS.GPT4O;
        else if (requestedModel === 'claude3') modelId = MODELS.CLAUDE3;
        else if (requestedModel.includes('/')) modelId = requestedModel;

        const data = await runAI(env, modelId, { max_tokens: maxTokens, temperature }, 'openrouter');
        return data.choices?.[0]?.message?.content?.trim();
      }
    }
  ];

  // If a specific model is requested, we prefer Workers AI if healthy, UNLESS it's a Gemini/Flash model
  const isExplicitGemini = requestedModel && (requestedModel.toLowerCase().includes('gemini') || requestedModel.toLowerCase().includes('flash'));
  if (requestedModel && requestedModel !== 'auto' && !isExplicitGemini && providers[1].health.isHealthy()) {
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
  if (request.method !== 'POST') return errorResponse('Method Not Allowed', 405, corsHeaders);
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
    return errorResponse(`AI Error: ${e.message}`, 500, corsHeaders);
  }
}

// ----------------------------------------------------------------------------
// Chat (Hardened)
// ----------------------------------------------------------------------------
async function handleChat(request: Request, env: Env, ctx: ExecutionContext, corsHeaders: any): Promise<Response> {
  if (request.method !== 'POST') return errorResponse('Method Not Allowed', 405, corsHeaders);
  const { message, history = [], model } = await request.json() as any;

  // --- Project Bible Grounding ---
  let bibleContext = '';
  try {
    const loreObj = await env.R2_ASSETS.get(WORKSPACE_PREFIX + 'BIBLE_LORE.md');
    if (loreObj) bibleContext += `\nProject Lore:\n${await loreObj.text()}\n`;

    const taskObj = await env.R2_ASSETS.get(WORKSPACE_PREFIX + 'BIBLE_TASKS.json');
    if (taskObj) bibleContext += `\nActive Tasks:\n${await taskObj.text()}\n`;
  } catch (e) { }

  // Use structured messages for better instruction following
  const messages = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n${bibleContext}` },
    ...history.map((m: any) => ({ role: m.role, content: m.content })),
    { role: 'user', content: message }
  ];

  try {
    const result = await generateCompletion(env, messages, 1024, model, 0.3);

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
    return errorResponse(`Chat Error: ${e.message}`, 500, corsHeaders);
  }
}

// ----------------------------------------------------------------------------
// Explain code (Multi-Model)
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// Explain Code (Hardened)
// ----------------------------------------------------------------------------
async function handleExplain(request: Request, env: Env, ctx: ExecutionContext, corsHeaders: any): Promise<Response> {
  if (request.method !== 'POST') return errorResponse('Method Not Allowed', 405, corsHeaders);
  const { code, language } = await request.json() as any;
  const prompt = `Explain this ${language} code concisely:\n\`\`\`${language}\n${code}\n\`\`\`\n\nExplanation:`;

  try {
    const result = await generateCompletion(env, prompt, 512, 'coding', 0);
    ctx.waitUntil(incrementKVQuota(env));
    return json({ explanation: result.completion, provider: result.provider }, 200, corsHeaders);
  } catch (e: any) {
    return errorResponse(e.message, 500, corsHeaders);
  }
}

// ----------------------------------------------------------------------------
// Recommendation 7: doctor --fix Logic
// ----------------------------------------------------------------------------
async function handleDoctor(request: Request, env: Env, ctx: ExecutionContext, corsHeaders: any): Promise<Response> {
  if (request.method !== 'GET') return errorResponse('Method Not Allowed', 405, corsHeaders);
  const issues: string[] = [];
  const fixes: string[] = [];
  const status_report: any = {};

  // Check Core Bindings
  status_report.AI = !!env.AI;
  status_report.R2 = !!env.R2_ASSETS;
  status_report.MEMORY_KV = !!env.MEMORY;
  status_report.CACHE_KV = !!env.CACHE;
  status_report.RATE_LIMITER = !!env.RATE_LIMITER;

  // Enumerate keys (redacted) to identify hidden naming issues
  status_report.DEBUG_KEYS = Object.keys(env).map(k => k.replace(/API_KEY|TOKEN|SECRET|PASSWORD/i, '[REDACTED]'));

  // Check Secrets (Presence only)
  status_report.GEMINI_SECRET = !!(env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY || (env as any).GOOGLE_API_KEY || (env as any).GEMINI_KEY);
  status_report.CLOUDFLARE_AUTH = !!env.CLOUDFLARE_API_TOKEN;
  status_report.OLLAMA_SECRET = !!env.OLLAMA_URL;

  if (!env.AI) issues.push('AI binding missing');
  if (!env.R2_ASSETS) issues.push('R2_ASSETS binding missing');
  if (!env.MEMORY) issues.push('MEMORY (KV) binding missing');
  if (!env.RATE_LIMITER) issues.push('RATE_LIMITER (DO) binding missing');
  if (!status_report.GEMINI_SECRET) issues.push('Gemini API secret missing (VITE_GEMINI_API_KEY or GEMINI_API_KEY)');

  // Check Quota
  const today = new Date().toISOString().split('T')[0];
  const writeCount = parseInt(await env.CACHE.get(`kvWriteCount:${today}`) || '0');
  if (writeCount > 900) issues.push(`KV Quota Critical (${writeCount}/1000)`);

  const status = issues.length === 0 ? 'Optimal' : (issues.length < 3 ? 'Degraded' : 'Critical');

  return json({
    status,
    timestamp: Date.now(),
    bindings: status_report,
    issues,
    fixes,
    recommendation: issues.length > 0 ? "Check your Cloudflare Dashboard bindings or wrangler.jsonc." : "All systems green."
  }, 200, corsHeaders);
}

const WORKSPACE_PREFIX = 'projects/default/';

// Helper: Refresh KV File Index
async function refreshKVIndex(env: Env): Promise<void> {
  try {
    const list = await env.R2_ASSETS.list({ prefix: WORKSPACE_PREFIX });
    const files = list.objects.map(o => ({
      name: o.key.replace(WORKSPACE_PREFIX, ''),
      size: o.size,
      uploaded: o.uploaded
    })).filter(f => f.name !== '');

    // Cache for 1 hour, but we manually invalidate on writes
    await env.CACHE.put('index:default', JSON.stringify(files), { expirationTtl: 3600 });
  } catch (e) { console.error('Index Refresh Error:', e); }
}

async function handleFilesystem(request: Request, env: Env, ctx: ExecutionContext, corsHeaders: any): Promise<Response> {
  const url = new URL(request.url);

  // Search Files (R2 implementation) - Enforce POST for hardening
  if (request.method === 'POST' && url.pathname === '/api/fs/search') {
    let pattern = '';
    try {
      const body = await request.json() as { pattern: string };
      pattern = body.pattern;
    } catch (e) {
      return errorResponse('Invalid JSON body', 400, corsHeaders);
    }

    if (!pattern) return errorResponse('Missing pattern', 400, corsHeaders);

    try {
      const list = await env.R2_ASSETS.list({ prefix: WORKSPACE_PREFIX });
      const results: any[] = [];

      for (const obj of list.objects) {
        if (obj.key.match(/\.(png|jpg|jpeg|glb|gltf|gif|webp|woff2|ttf|mp3|wav|ogg)$/i)) continue;

        const file = await env.R2_ASSETS.get(obj.key);
        if (file) {
          const content = await file.text();
          const lines = content.split('\n');
          lines.forEach((line, index) => {
            if (line.toLowerCase().includes(pattern.toLowerCase())) {
              results.push({
                file: obj.key.replace(WORKSPACE_PREFIX, ''),
                line: index + 1,
                content: line.trim().substring(0, 200)
              });
            }
          });
        }
        if (results.length > 50) break;
      }
      return json({ results }, 200, corsHeaders);
    } catch (e: any) {
      return errorResponse(e.message, 500, corsHeaders);
    }
  }

  // List Files (Optimized with KV Cache)
  if (request.method === 'GET' && url.pathname === '/api/fs/list') {
    try {
      // 1. Try Read from Cache
      const cached = await env.CACHE.get('index:default', 'json');
      if (cached) return json(cached, 200, corsHeaders);

      // 2. Fallback to R2 (and update cache)
      const list = await env.R2_ASSETS.list({ prefix: WORKSPACE_PREFIX });
      const files = list.objects.map(o => ({
        name: o.key.replace(WORKSPACE_PREFIX, ''),
        size: o.size,
        uploaded: o.uploaded
      })).filter(f => f.name !== '');

      // Async update cache
      // @ts-ignore
      if (typeof ctx.waitUntil === 'function') ctx.waitUntil(refreshKVIndex(env));

      return json(files, 200, corsHeaders);
    } catch (e: any) {
      return errorResponse(e.message, 500, corsHeaders);
    }
  }

  // Get File
  if (request.method === 'GET' && url.pathname === '/api/fs/file') {
    const name = url.searchParams.get('name');
    if (!name) return errorResponse('Missing name', 400, corsHeaders);

    const obj = await env.R2_ASSETS.get(WORKSPACE_PREFIX + name);
    if (!obj) return errorResponse('Not found', 404, corsHeaders);

    const isBinary = name.match(/\.(png|jpg|jpeg|glb|gltf|gif|webp)$/i);
    if (isBinary) {
      return new Response(obj.body, { headers: { ...corsHeaders, 'Content-Type': 'application/octet-stream' } });
    }
    const content = await obj.text();
    return json({ content }, 200, corsHeaders);
  }

  // Save File
  if (request.method === 'POST' && url.pathname === '/api/fs/file') {
    try {
      const { name, content, encoding } = await request.json() as { name: string, content: string, encoding?: string };
      if (!name) return errorResponse('Missing name', 400, corsHeaders);

      let body: any = content;
      if (encoding === 'base64') {
        const binString = atob(content);
        body = Uint8Array.from(binString, c => c.charCodeAt(0));
      }

      await env.R2_ASSETS.put(WORKSPACE_PREFIX + name, body);

      // Update Index
      // @ts-ignore
      if (typeof ctx.waitUntil === 'function') ctx.waitUntil(refreshKVIndex(env));
      // Also increment quota
      // @ts-ignore
      if (typeof ctx.waitUntil === 'function') ctx.waitUntil(incrementKVQuota(env));

      return json({ success: true }, 200, corsHeaders);
    } catch (e: any) {
      return errorResponse(`Save Failed: ${e.message}`, 500, corsHeaders);
    }
  }

  // Delete File
  if (request.method === 'DELETE' && url.pathname === '/api/fs/file') {
    try {
      const { name } = await request.json() as { name: string };
      if (!name) return errorResponse('Missing name', 400, corsHeaders);

      // Robustness: handle names that potentially already include the prefix
      const fullKey = name.startsWith(WORKSPACE_PREFIX) ? name : WORKSPACE_PREFIX + name;
      await env.R2_ASSETS.delete(fullKey);
      // Update Index
      // @ts-ignore
      if (typeof ctx.waitUntil === 'function') ctx.waitUntil(refreshKVIndex(env));
      return json({ success: true }, 200, corsHeaders);
    } catch (e: any) {
      return errorResponse(`Delete Failed: ${e.message}`, 500, corsHeaders);
    }
  }

  return errorResponse('FS Method Not Allowed', 405, corsHeaders);
}

function json(data: any, status = 200, corsHeaders: any = {}): Response {
  let body = JSON.stringify(data);
  if (status >= 400) body = redact(body);
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

function redact(str: string): string {
  if (!str) return str;
  return str.replace(/GEMINI_API_KEY|OLLAMA_AUTH_TOKEN|CLOUDFLARE_API_TOKEN|ACCOUNT_ID|AIza[A-Za-z0-9_-]+|fw_[a-zA-Z0-9]{20,}|key_[a-zA-Z0-9]{20,}/gi, '[REDACTED]');
}

function errorResponse(message: string, status = 500, corsHeaders = {}): Response {
  return new Response(redact(message), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
  });
}
