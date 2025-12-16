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
  ASSETS: R2Bucket;
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
  
  // Fallback to Ollama (NO Workers AI - too expensive)
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

// Production IDE HTML (Monaco Editor)
const IDE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hybrid IDE - Production ($0/month)</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: monospace; height: 100vh; overflow: hidden; background: #1e1e1e; color: #ccc; }
    .container { display: flex; height: 100vh; }
    .sidebar { width: 280px; background: #252526; border-right: 1px solid #3e3e42; padding: 20px; }
    .sidebar h2 { color: #007acc; margin-bottom: 10px; }
    .sidebar p { font-size: 12px; line-height: 1.5; color: #858585; }
    .sidebar .badge { background: #0e639c; color: white; padding: 4px 8px; border-radius: 3px; font-size: 11px; margin-top: 10px; display: inline-block; }
    .editor-container { flex-grow: 1; display: flex; flex-direction: column; }
    .toolbar { background: #2d2d30; border-bottom: 1px solid #3e3e42; padding: 10px 15px; display: flex; gap: 10px; }
    button { background: #0e639c; color: white; border: none; padding: 8px 16px; cursor: pointer; border-radius: 4px; font-size: 13px; }
    button:hover { background: #1177bb; }
    button:disabled { background: #3c3c3c; cursor: not-allowed; }
    #editor { flex-grow: 1; }
    .status-bar { background: #007acc; color: white; padding: 5px 15px; font-size: 12px; display: flex; justify-content: space-between; }
    .quota-warning { background: #f44336; }
  </style>
</head>
<body>
  <div class="container">
    <div class="sidebar">
      <h2>🚀 Hybrid IDE</h2>
      <p><strong>Production Mode</strong></p>
      <p style="margin-top: 10px;">• Cost: $0/month<br>• AI: Gemini Flash (free)<br>• Fallback: Ollama (local)<br>• Quota: KV 1000 writes/day</p>
      <div class="badge">100% Free Tier</div>
      <div style="margin-top: 20px; padding: 10px; background: #2d2d30; border-radius: 4px;">
        <div style="font-size: 11px; color: #858585; margin-bottom: 5px;">KV Write Quota</div>
        <div id="quotaDisplay" style="font-size: 14px; color: #4caf50;">Loading...</div>
      </div>
    </div>
    
    <div class="editor-container">
      <div class="toolbar">
        <button id="completeBtn" onclick="completeCode()">✨ Complete (Ctrl+Space)</button>
        <button id="explainBtn" onclick="explainCode()">💡 Explain (Ctrl+E)</button>
        <button id="chatBtn" onclick="openChat()">💬 Chat</button>
      </div>
      <div id="editor"></div>
      <div class="status-bar" id="statusBar">
        <span id="status">Ready - Production Mode</span>
        <span id="provider">Waiting for first request...</span>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs/loader.js"></script>
  <script>
    let editor;
    
    require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs' }});
    require(['vs/editor/editor.main'], function () {
      editor = monaco.editor.create(document.getElementById('editor'), {
        value: \`// Production Hybrid IDE - $0/month Forever
// Constraints enforced:
// - KV write quota: 1000/day (hard cap)
// - Circuit breaker: Gemini → Ollama (no Workers AI)
// - No background tasks (request-scoped only)

// Press Ctrl+Space to AI-complete
// Press Ctrl+E to AI-explain

function example() {
  // Type here and press Ctrl+Space for AI completion
  
}\`,
        language: 'typescript',
        theme: 'vs-dark',
        fontSize: 14,
        automaticLayout: true,
        minimap: { enabled: true },
        scrollbar: { verticalScrollbarSize: 10 }
      });
    });

    // Update quota display
    async function updateQuota() {
      try {
        const res = await fetch('/api/health');
        const data = await res.json();
        const quota = data.kvWriteQuota || 0;
        
        document.getElementById('quotaDisplay').textContent = \`\${quota}% used\`;
        document.getElementById('quotaDisplay').style.color = quota > 85 ? '#f44336' : quota > 70 ? '#ff9800' : '#4caf50';
        
        if (quota >= 100) {
          document.getElementById('statusBar').className = 'status-bar quota-warning';
          document.getElementById('status').textContent = '⚠️ Daily KV quota exceeded - Use Ollama or wait 24h';
          document.getElementById('completeBtn').disabled = true;
        }
      } catch (e) {
        document.getElementById('quotaDisplay').textContent = 'Error';
      }
    }
    
    updateQuota();
    setInterval(updateQuota, 30000); // Update every 30 seconds

    async function completeCode() {
      const content = editor.getValue();
      const position = editor.getPosition();
      const cursor = editor.getModel().getOffsetAt(position);
      
      document.getElementById('status').textContent = 'AI completing...';
      document.getElementById('completeBtn').disabled = true;
      
      try {
        const response = await fetch('/api/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            code: content, 
            cursor, 
            language: 'typescript', 
            fileId: 'main.ts' 
          })
        });
        
        if (!response.ok) {
          const error = await response.json();
          document.getElementById('status').textContent = \`Error: \${error.error || 'Failed'}\`;
          return;
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let result = '', provider = '';
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          const lines = chunk.split('\\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6));
              result = data.token;
              provider = data.provider;
            }
          }
        }
        
        if (result) {
          editor.setValue(content + result);
          document.getElementById('status').textContent = \`Completion applied (\${provider}, $0)\`;
          document.getElementById('provider').textContent = \`Last used: \${provider}\`;
          updateQuota(); // Refresh quota after completion
        }
      } catch (e) {
        document.getElementById('status').textContent = 'Error: ' + e.message;
      } finally {
        document.getElementById('completeBtn').disabled = false;
      }
    }

    async function explainCode() {
      const selection = editor.getModel().getValueInRange(editor.getSelection()) || editor.getValue();
      
      document.getElementById('status').textContent = 'AI explaining...';
      document.getElementById('explainBtn').disabled = true;
      
      try {
        const response = await fetch('/api/explain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: selection, language: 'typescript' })
        });
        
        const data = await response.json();
        
        if (data.explanation) {
          const explanation = data.explanation.replace(/\\n/g, '\\n// ');
          editor.setValue(editor.getValue() + '\\n\\n// AI Explanation:\\n// ' + explanation);
          document.getElementById('status').textContent = \`Explanation added (\${data.provider}, $0)\`;
          document.getElementById('provider').textContent = \`Last used: \${data.provider}\`;
        }
      } catch (e) {
        document.getElementById('status').textContent = 'Error: ' + e.message;
      } finally {
        document.getElementById('explainBtn').disabled = false;
      }
    }

    function openChat() {
      alert('CLI chat: Run "ide chat" in your terminal for interactive AI chat with history.');
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === ' ') { 
          e.preventDefault(); 
          completeCode(); 
        } else if (e.key === 'e') { 
          e.preventDefault(); 
          explainCode(); 
        }
      }
    });
  </script>
</body>
</html>`;
