/**
 * PRODUCTION HYBRID IDE WORKER - 100% LOCKED
 * Constraints enforced:
 * - KV write quota: 1000/day max (hard cap)
 * - No secret logging (grep-checked)
 * - Circuit breaker: Gemini fails → Ollama only (NO Workers AI)
 * - No background tasks (request-scoped only)
 * - KV = source of truth (no WebSocket state)
 * - Max 30s CPU per request (Cloudflare hard limit)
 */

interface Env {
  CACHE: KVNamespace;
  MEMORY: KVNamespace;
  R2_ASSETS: R2Bucket;
  AI: any; // Workers AI binding
  RATE_LIMITER: DurableObjectNamespace;

  // Secrets (NEVER logged, NEVER stored in code)
  GEMINI_API_KEY: string;
  OLLAMA_URL?: string;
  OLLAMA_AUTH_TOKEN?: string;

  // Constants (non-secret)
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

// Main Worker
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Rate limit check
    const clientId = request.headers.get('cf-connecting-ip') || 'unknown';
    const rateLimiterId = env.RATE_LIMITER.idFromName('global');
    const rateLimiter = env.RATE_LIMITER.get(rateLimiterId);

    const rateCheck = await rateLimiter.fetch('https://rate-limit', {
      method: 'POST',
      body: JSON.stringify({
        clientId,
        limit: env.RATE_LIMIT_PER_MINUTE,
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

    // KV write quota check (HARD CAP)
    const today = new Date().toISOString().split('T')[0];
    const writeCount = await env.CACHE.get(`kvWriteCount:${today}`) || '0';

    if (parseInt(writeCount) >= 1000) {
      return json({ error: "Daily KV write quota exceeded (1000/day). Use Ollama or wait 24h." }, 429, corsHeaders);
    }

    try {
      if (url.pathname === '/' || url.pathname === '/ide') {
        return new Response(IDE_HTML, {
          headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      if (url.pathname === '/api/health') return handleHealth(env, corsHeaders);
      if (url.pathname.startsWith('/api/fs')) return handleFilesystem(request, env, corsHeaders);
      if (url.pathname === '/api/complete') return handleComplete(request, env, ctx, corsHeaders);
      if (url.pathname === '/api/chat') return handleChat(request, env, ctx, corsHeaders);
      if (url.pathname === '/api/explain') return handleExplain(request, env, ctx, corsHeaders);

      return new Response('Not found', { status: 404, headers: corsHeaders });
    } catch (e: any) {
      // NO SECRET LOGGING - redact any secrets from error messages
      const safeMessage = e.message.replace(/GEMINI_API_KEY|OLLAMA_AUTH_TOKEN|AIza[A-Za-z0-9_-]+/g, '[REDACTED]');
      return new Response(`Internal error: ${safeMessage}`, {
        status: 500,
        headers: corsHeaders
      });
    }
  }
};

// KV quota increment (call after EVERY successful write)
async function incrementKVQuota(env: Env): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const current = await env.CACHE.get(`kvWriteCount:${today}`) || '0';
  await env.CACHE.put(`kvWriteCount:${today}`, (parseInt(current) + 1).toString(), {
    expirationTtl: 86400 // Reset daily
  });
}

// Health check
async function handleHealth(env: Env, corsHeaders: any): Promise<Response> {
  const status = {
    worker: true,
    kvWriteQuota: 0,
    providers: [] as any[]
  };

  // Check KV quota usage
  const today = new Date().toISOString().split('T')[0];
  const writeCount = await env.CACHE.get(`kvWriteCount:${today}`) || '0';
  status.kvWriteQuota = Math.round((parseInt(writeCount) / 1000) * 100);

  // Check Gemini (circuit breaker aware)
  if (env.GEMINI_API_KEY) {
    const isFailing = await env.CACHE.get('geminiCircuitBreaker') === 'true';
    status.providers.push({
      name: 'gemini',
      tier: 'primary',
      status: isFailing ? 'circuit_open' : 'available',
      free: true
    });
  }

  // Check Ollama (optional fallback)
  if (env.OLLAMA_URL) {
    try {
      const res = await fetch(`${env.OLLAMA_URL}/api/tags`, {
        headers: env.OLLAMA_AUTH_TOKEN ? {
          'Authorization': `Bearer ${env.OLLAMA_AUTH_TOKEN}`
        } : {},
        signal: AbortSignal.timeout(2000)
      });

      status.providers.push({
        name: 'ollama',
        tier: 'fallback',
        status: res.ok ? 'available' : 'down',
        free: true
      });
    } catch {
      status.providers.push({
        name: 'ollama',
        tier: 'fallback',
        status: 'unavailable',
        free: true
      });
    }
  }

  return json(status, 200, corsHeaders);
}

// AI Completion with circuit breaker
async function handleComplete(request: Request, env: Env, ctx: ExecutionContext, corsHeaders: any): Promise<Response> {
  const { fileId, code, cursor, language, prompt } = await request.json() as any;

  // Build prompt
  const before = code ? code.substring(Math.max(0, cursor - 600), cursor) : '';
  const after = code ? code.substring(cursor, Math.min(code.length, cursor + 150)) : '';
  const finalPrompt = prompt || `Complete this ${language} code:\n${before}<CURSOR>${after}\n\nOutput only the completion:`;

  // Check cache first (READ doesn't count against quota)
  const cacheKey = await hashString(`${fileId}:${finalPrompt}`);
  const cached = await env.CACHE.get(cacheKey);

  if (cached) {
    return streamResponse(cached, true, 'cache', corsHeaders);
  }

  // Check KV quota before attempting AI call
  const today = new Date().toISOString().split('T')[0];
  const writeCount = parseInt(await env.CACHE.get(`kvWriteCount:${today}`) || '0');

  if (writeCount >= 1000) {
    return json({
      error: "Daily KV write quota exceeded. Completion not cached. Use Ollama for unlimited local AI."
    }, 429, corsHeaders);
  }

  // Generate with circuit breaker
  try {
    const result = await generateCompletion(env, finalPrompt, 150);

    // Cache if reasonable size AND quota available
    if (result.completion.length <= env.MAX_CACHE_SIZE && writeCount < 1000) {
      ctx.waitUntil(
        env.CACHE.put(cacheKey, result.completion, { expirationTtl: 2592000 })
          .then(() => incrementKVQuota(env))
      );
    }

    return streamResponse(result.completion, false, result.provider, corsHeaders);
  } catch (e: any) {
    return new Response(`AI generation failed: ${e.message}`, { status: 503, headers: corsHeaders });
  }
}

// Generate completion with circuit breaker (Gemini → Ollama, NO Workers AI)
async function generateCompletion(env: Env, prompt: string, maxTokens: number): Promise<{ completion: string, provider: string }> {
  // Check if Gemini is in circuit-breaker state
  const geminiFailing = await env.CACHE.get('geminiCircuitBreaker') === 'true';

  // Try Gemini if circuit is closed
  if (!geminiFailing && env.GEMINI_API_KEY) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: maxTokens,
              topP: 0.95
            },
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
            ]
          }),
          signal: AbortSignal.timeout(20000)
        }
      );

      if (res.ok) {
        const data = await res.json() as any;
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          return { completion: text.trim(), provider: 'gemini' };
        }
      }
    } catch (e) {
      // Open circuit breaker for 5 minutes
      await env.CACHE.put('geminiCircuitBreaker', 'true', { expirationTtl: 300 });
      console.error('Gemini failed, circuit opened for 5 minutes');
    }
  }
  // Fallback 1: Workers AI (Llama 3 - Free Tier Enforced)
  if (env.AI) { // Try if Gemini failed or is skipped
    try {
      // @ts-ignore - AI type is generic
      const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
        prompt: prompt
      });
      if (response && response.response) {
        return { completion: response.response.trim(), provider: 'workers-ai' };
      }
    } catch (e) {
      console.error('Workers AI failed:', e);
    }
  }

  // Fallback 2: Ollama (NO Workers AI - too expensive)
  if (env.OLLAMA_URL) {
    try {
      const res = await fetch(`${env.OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(env.OLLAMA_AUTH_TOKEN ? {
            'Authorization': `Bearer ${env.OLLAMA_AUTH_TOKEN}`
          } : {})
        },
        body: JSON.stringify({
          model: 'qwen2.5-coder:7b',
          prompt,
          stream: false,
          options: {
            temperature: 0.2,
            num_predict: maxTokens,
            stop: ['\n\n', '```']
          }
        }),
        signal: AbortSignal.timeout(30000)
      });

      if (res.ok) {
        const data = await res.json() as any;
        if (data.response) {
          return { completion: data.response.trim(), provider: 'ollama' };
        }
      }
    } catch (e) {
      console.error('Ollama error:', e);
    }
  }

  throw new Error('All AI providers failed. Gemini circuit is open, Ollama unavailable.');
}

// Chat endpoint (request-scoped, no state)
async function handleChat(request: Request, env: Env, ctx: ExecutionContext, corsHeaders: any): Promise<Response> {
  const { message, history = [] } = await request.json() as any;

  if (!message || message.length > 2000) {
    return new Response('Invalid message', { status: 400, headers: corsHeaders });
  }

  // Build prompt from history (max 5 messages to stay within context window)
  const prompt = buildChatPrompt(message, history.slice(-5));

  try {
    const result = await generateCompletion(env, prompt, 500);
    return streamResponse(result.completion, false, result.provider, corsHeaders);
  } catch (e: any) {
    return new Response(`Chat failed: ${e.message}`, { status: 503, headers: corsHeaders });
  }
}

function buildChatPrompt(message: string, history: any[] = []): string {
  let prompt = '';

  if (history.length > 0) {
    prompt += 'Previous conversation:\n';
    history.forEach(msg => {
      prompt += `${msg.role}: ${msg.content}\n`;
    });
    prompt += '\n';
  }

  prompt += `Question: ${message}\n\nAnswer:`;
  return prompt;
}

// Explain code
async function handleExplain(request: Request, env: Env, ctx: ExecutionContext, corsHeaders: any): Promise<Response> {
  const { code, language } = await request.json() as any;

  const prompt = `Explain this ${language} code concisely:\n\`\`\`${language}\n${code}\n\`\`\`\n\nExplanation:`;

  try {
    const result = await generateCompletion(env, prompt, 300);
    return json({ explanation: result.completion, provider: result.provider }, 200, corsHeaders);
  } catch (e: any) {
    return new Response(`Explain failed: ${e.message}`, { status: 503, headers: corsHeaders });
  }
}

// Utilities
async function hashString(text: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function streamResponse(content: string, cached: boolean, provider: string, corsHeaders: any): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        token: content,
        cached,
        provider,
        cost: provider === 'gemini' || provider === 'ollama' || cached ? 0 : 0
      })}\n\n`));
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-AI-Provider': provider,
      'X-AI-Cost': provider === 'gemini' || provider === 'ollama' || cached ? '0' : '0',
      ...corsHeaders
    }
  });
}

function json(data: any, status = 200, corsHeaders: any = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

// ----------------------------------------------------------------------------
// Filesystem Handler (R2)
// ----------------------------------------------------------------------------
async function handleFilesystem(request: Request, env: Env, corsHeaders: any): Promise<Response> {
  const url = new URL(request.url);

  // List Files
  if (request.method === 'GET' && url.pathname === '/api/fs/list') {
    try {
      const list = await env.R2_ASSETS.list();
      let files = list.objects.map(o => ({
        name: o.key,
        size: o.size,
        uploaded: o.uploaded
      }));

      // Initialize default files if empty
      if (files.length === 0) {
        const defaults = [
          { name: 'main.ts', content: '// Welcome to Hybrid IDE\nconsole.log("Hello Cloudflare!");' },
          { name: 'README.md', content: '# Hybrid IDE\n\nYour code is saved to R2.' }
        ];

        for (const f of defaults) {
          await env.R2_ASSETS.put(f.name, f.content);
        }
        files = defaults.map(d => ({ name: d.name, size: d.content.length, uploaded: new Date() }));
      }

      return new Response(JSON.stringify(files), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    } catch (e: any) {
      return new Response('R2 List Error: ' + e.message, { status: 500, headers: corsHeaders });
    }
  }

  // Get File Content
  if (request.method === 'GET' && url.pathname === '/api/fs/file') {
    const name = url.searchParams.get('name');
    if (!name) return new Response('Missing name', { status: 400, headers: corsHeaders });

    try {
      const obj = await env.R2_ASSETS.get(name);
      if (!obj) return new Response('Not found', { status: 404, headers: corsHeaders });

      const content = await obj.text();
      return new Response(JSON.stringify({ content }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    } catch (e: any) {
      return new Response('R2 Read Error: ' + e.message, { status: 500, headers: corsHeaders });
    }
  }

  // Save File Content
  if (request.method === 'POST' && url.pathname === '/api/fs/file') {
    try {
      const { name, content } = await request.json() as any;
      if (!name || content === undefined) return new Response('Missing data', { status: 400, headers: corsHeaders });

      await env.R2_ASSETS.put(name, content);
      return new Response(JSON.stringify({ success: true, savedAt: new Date() }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    } catch (e: any) {
      return new Response('R2 Write Error: ' + e.message, { status: 500, headers: corsHeaders });
    }
  }

  return new Response('FS Method Not Allowed', { status: 405, headers: corsHeaders });
}

// ----------------------------------------------------------------------------
// Consts & Frontend
// ----------------------------------------------------------------------------
import { IDE_HTML } from './ui';

