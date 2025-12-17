
import { Ai } from '@cloudflare/ai';

export interface Env {
  AI: Ai;
  CACHE: KVNamespace;
  R2_ASSETS: R2Bucket;
  GEMINI_API_KEY?: string;
  OLLAMA_URL?: string;
  OLLAMA_AUTH_TOKEN?: string;
  MAX_CACHE_SIZE: number;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS Headers
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
      return new Response(IDE_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // Router
    switch (url.pathname) {
      case '/api/complete':
        return handleComplete(request, env, ctx, corsHeaders);
      case '/api/explain':
        return handleExplain(request, env, ctx, corsHeaders);
      case '/api/chat':
        return handleChat(request, env, ctx, corsHeaders);
      case '/api/fs/list':
      case '/api/fs/file':
        return handleFilesystem(request, env, corsHeaders);
      case '/api/health':
        return handleHealth(request, env, corsHeaders);
      default:
        return new Response('Not Found', { status: 404, headers: corsHeaders });
    }
  }
};

// ----------------------------------------------------------------------------
// Health & Status
// ----------------------------------------------------------------------------
async function incrementKVQuota(env: Env) {
  const today = new Date().toISOString().split('T')[0];
  const count = parseInt(await env.CACHE.get(`kvWriteCount:${today}`) || '0');
  await env.CACHE.put(`kvWriteCount:${today}`, (count + 1).toString());
}

async function handleHealth(request: Request, env: Env, corsHeaders: any): Promise<Response> {
  const status: any = {
    status: 'healthy',
    region: request.cf?.colo,
    providers: [],
    kvWriteQuota: 0
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

  // 1. Try Llama 3.3 70B (Primary) - True Streaming
  if (env.AI) {
    try {
      // Explicitly cast to any to allow 3rd argument (options) which is missing in strict types
      const stream: any = await (env.AI as any).run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        prompt: finalPrompt,
        max_tokens: 256,
      }, {
        returnRawResponse: true
      });

      // Transform Cloudflare SSE format to our UI format
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const reader = stream.body?.getReader();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      if (reader) {
        ctx.waitUntil((async () => {
          let fullCompletion = '';
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value, { stream: true });
              const lines = chunk.split('\n');

              for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                  try {
                    const data = JSON.parse(line.slice(6));
                    if (data.response) {
                      fullCompletion += data.response;
                      // Re-emit in our format
                      const uiMessage = `data: ${JSON.stringify({
                        token: data.response,
                        cached: false,
                        provider: 'llama-3.3-70b',
                        cost: 0
                      })}\n\n`;
                      await writer.write(encoder.encode(uiMessage));
                    }
                  } catch (e) { /* ignore parse error in chunk */ }
                }
              }
            }
          } catch (e) {
            console.error('Stream error:', e);
          } finally {
            await writer.close();
            // Cache full result if successful and under size limit
            if (fullCompletion.length > 0 && fullCompletion.length <= env.MAX_CACHE_SIZE && writeCount < 1000) {
              await env.CACHE.put(cacheKey, fullCompletion, { expirationTtl: 2592000 });
              await incrementKVQuota(env);
            }
          }
        })());

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'X-AI-Provider': 'llama-3.3-70b',
            ...corsHeaders
          }
        });
      }
    } catch (e) {
      console.warn('Llama 3.3 failed, falling back to Gemini/Ollama:', e);
    }
  }

  // 2. Fallback: Gemini / Ollama / Legacy Logic
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
      // @ts-ignore - Handle type mismatch safely
      if (response && response.response) {
        // @ts-ignore
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

  // Build prompt from history (max 8 messages for context)
  const prompt = buildChatPrompt(message, history.slice(-8));

  // 1. Try Llama 3.3 70B (Primary) - True Streaming
  if (env.AI) {
    try {
      // Explicitly cast to any to allow 3rd argument (options)
      const stream: any = await (env.AI as any).run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        prompt: prompt,
        max_tokens: 1024, // Longer output for chat
      }, {
        returnRawResponse: true
      });

      // Transform Cloudflare SSE format to our UI format
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const reader = stream.body?.getReader();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      if (reader) {
        ctx.waitUntil((async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value, { stream: true });
              const lines = chunk.split('\n'); // Standard newline splitting from Workers AI

              for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                  try {
                    const data = JSON.parse(line.slice(6));
                    if (data.response) {
                      // Re-emit in our format
                      const uiMessage = `data: ${JSON.stringify({
                        token: data.response,
                        cached: false,
                        provider: 'llama-3.3-70b',
                        cost: 0
                      })}\n\n`;
                      await writer.write(encoder.encode(uiMessage));
                    }
                  } catch (e) { /* ignore parse error in chunk */ }
                }
              }
            }
          } catch (e) {
            console.error('Chat Stream error:', e);
            await writer.write(encoder.encode(`data: ${JSON.stringify({ token: "\n[Error: Connection interrupted]", provider: "system" })}\n\n`));
          } finally {
            await writer.close();
          }
        })());

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'X-AI-Provider': 'llama-3.3-70b',
            ...corsHeaders
          }
        });
      }
    } catch (e) {
      console.warn('Chat Llama 3.3 failed, falling back:', e);
    }
  }

  // Fallback to legacy non-streaming
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
// Filesystem Handler (R2 - Sandboxed)
// ----------------------------------------------------------------------------
const WORKSPACE_PREFIX = 'projects/default/';

async function handleFilesystem(request: Request, env: Env, corsHeaders: any): Promise<Response> {
  const url = new URL(request.url);

  // List Files
  if (request.method === 'GET' && url.pathname === '/api/fs/list') {
    try {
      // List only files in the workspace
      const list = await env.R2_ASSETS.list({ prefix: WORKSPACE_PREFIX });
      let files = list.objects.map(o => ({
        name: o.key.replace(WORKSPACE_PREFIX, ''), // Strip prefix for UI
        size: o.size,
        uploaded: o.uploaded
      })).filter(f => f.name !== ''); // Filter out the folder key itself if present

      // Initialize default files if empty (and no root prefix exists)
      if (files.length === 0) {
        const defaults = [
          { name: 'main.ts', content: '// Welcome to Hybrid IDE\nconsole.log("Hello Cloudflare!");' },
          { name: 'README.md', content: '# Hybrid IDE\n\nYour code is saved to R2 in a sandboxed workspace.' }
        ];

        for (const f of defaults) {
          await env.R2_ASSETS.put(WORKSPACE_PREFIX + f.name, f.content);
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
      const obj = await env.R2_ASSETS.get(WORKSPACE_PREFIX + name);
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

      // Prevent directory traversal (basic check)
      if (name.includes('..') || name.startsWith('/')) {
        return new Response('Invalid filename', { status: 400, headers: corsHeaders });
      }

      await env.R2_ASSETS.put(WORKSPACE_PREFIX + name, content);
      return new Response(JSON.stringify({ success: true, savedAt: new Date() }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    } catch (e: any) {
      return new Response('R2 Write Error: ' + e.message, { status: 500, headers: corsHeaders });
    }
  }

  return new Response('FS Method Not Allowed', { status: 405, headers: corsHeaders });
}
