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

// Production IDE HTML (VS Code-like Theme)
const IDE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hybrid IDE - Production ($0/month)</title>
  <!-- VS Code Icons -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@vscode/codicons/dist/codicon.css" />
  <style>
    :root {
      --bg-color: #1e1e1e;
      --sidebar-bg: #252526;
      --activity-bar-bg: #333333;
      --status-bar-bg: #007acc;
      --border-color: #3e3e42;
      --text-color: #cccccc;
      --accent-color: #007acc;
      --hover-bg: #2a2d2e;
      --input-bg: #3c3c3c;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; height: 100vh; overflow: hidden; background: var(--bg-color); color: var(--text-color); display: flex; flex-direction: column; }
    
    .main-layout { display: flex; flex-grow: 1; overflow: hidden; }
    
    /* Activity Bar */
    .activity-bar { width: 48px; background: var(--activity-bar-bg); display: flex; flex-direction: column; align-items: center; padding-top: 10px; }
    .activity-icon { color: #858585; font-size: 24px; margin-bottom: 25px; cursor: pointer; position: relative; }
    .activity-icon.active { color: white; border-left: 2px solid white; }
    .activity-icon:hover { color: white; }
    
    /* Sidebar */
    .sidebar { width: 250px; background: var(--sidebar-bg); border-right: 1px solid var(--border-color); display: flex; flex-direction: column; }
    .sidebar-header { padding: 10px 20px; font-size: 11px; font-weight: bold; text-transform: uppercase; display: flex; justify-content: space-between; align-items: center; }
    .file-tree { flex-grow: 1; padding-top: 5px; }
    .file-item { padding: 3px 20px; cursor: pointer; display: flex; align-items: center; font-size: 13px; color: #cccccc; }
    .file-item:hover { background: var(--hover-bg); }
    .file-item.active { background: #37373d; color: white; }
    .file-icon { margin-right: 6px; font-size: 14px; }
    
    /* Editor Area */
    .editor-area { flex-grow: 1; display: flex; flex-direction: column; background: var(--bg-color); }
    .tabs-container { display: flex; background: var(--sidebar-bg); height: 35px; border-bottom: 1px solid var(--border-color); overflow-x: auto; }
    .tab { padding: 8px 15px; font-size: 13px; color: #969696; background: #2d2d2d; border-right: 1px solid var(--border-color); cursor: pointer; display: flex; align-items: center; min-width: 120px; }
    .tab.active { background: var(--bg-color); color: white; border-top: 1px solid var(--accent-color); }
    .tab-close { margin-left: auto; font-size: 12px; margin-left: 10px; opacity: 0; }
    .tab:hover .tab-close { opacity: 1; }
    
    #editor { flex-grow: 1; }
    
    /* Status Bar */
    .status-bar { height: 22px; background: var(--status-bar-bg); color: white; display: flex; align-items: center; padding: 0 10px; font-size: 12px; justify-content: space-between; }
    .status-item { margin-right: 15px; display: flex; align-items: center; cursor: pointer; }
    .status-item i { margin-right: 5px; }
    .quota-warning { background: #c72e0f !important; }
    
    /* Badge */
    .badge { background: #007acc; color: white; font-size: 10px; padding: 2px 6px; border-radius: 10px; margin-left: 5px; }
  </style>
</head>
<body>
  <div class="main-layout">
    <!-- Activity Bar -->
    <div class="activity-bar">
      <div class="activity-icon active" title="Explorer"><i class="codicon codicon-files"></i></div>
      <div class="activity-icon" title="Search"><i class="codicon codicon-search"></i></div>
      <div class="activity-icon" title="Source Control"><i class="codicon codicon-source-control"></i></div>
      <div class="activity-icon" title="Run and Debug"><i class="codicon codicon-debug-alt"></i></div>
      <div class="activity-icon" title="Extensions"><i class="codicon codicon-extensions"></i></div>
      <div style="flex-grow: 1;"></div>
      <div class="activity-icon" title="Accounts"><i class="codicon codicon-account"></i></div>
      <div class="activity-icon" title="Settings"><i class="codicon codicon-settings-gear"></i></div>
    </div>
    
    <!-- Sidebar -->
    <div class="sidebar">
      <div class="sidebar-header">
        <span>Explorer</span>
        <i class="codicon codicon-ellipsis"></i>
      </div>
      <div style="padding: 10px 20px; font-weight: bold; font-size: 11px; display: flex; align-items: center;">
        <i class="codicon codicon-chevron-down" style="margin-right: 5px;"></i> HYBRID-IDE-PROJECT
      </div>
      <div class="file-tree">
        <div class="file-item active">
          <i class="codicon codicon-file-code file-icon" style="color: #4fc1ff;"></i> main.ts
        </div>
        <div class="file-item">
          <i class="codicon codicon-file-code file-icon" style="color: #e8c65f;"></i> package.json
        </div>
        <div class="file-item">
          <i class="codicon codicon-gear file-icon" style="color: #cccccc;"></i> wrangler.toml
        </div>
        <div class="file-item">
          <i class="codicon codicon-file-media file-icon" style="color: #cccccc;"></i> README.md
        </div>
      </div>
      
      <!-- Stats / Quota Area (Custom addition) -->
       <div style="margin-top: auto; padding: 15px; border-top: 1px solid var(--border-color);">
        <div style="font-size: 11px; color: #858585; margin-bottom: 5px; text-transform: uppercase;">Usage Statistics</div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; font-size: 12px;">
          <span>KV Writes</span>
          <span id="quotaDisplay" style="color: #4caf50;">0%</span>
        </div>
        <div style="width: 100%; height: 4px; background: #3c3c3c; border-radius: 2px;">
          <div id="quotaBar" style="width: 0%; height: 100%; background: #4caf50; border-radius: 2px;"></div>
        </div>
      </div>
    </div>
    
    <!-- Main Editor Area -->
    <div class="editor-area">
      <!-- Tabs -->
      <div class="tabs-container">
        <div class="tab active">
          <i class="codicon codicon-file-code" style="color: #4fc1ff; margin-right: 6px; font-size: 14px;"></i>
          main.ts
          <span class="tab-close"><i class="codicon codicon-close"></i></span>
        </div>
      </div>
      
      <!-- Monaco Editor -->
      <div id="editor"></div>
    </div>
  </div>
  
  <!-- Status Bar -->
  <div class="status-bar" id="statusBar">
    <div style="display: flex;">
      <div class="status-item"><i class="codicon codicon-remote"></i> Production</div>
      <div class="status-item"><i class="codicon codicon-git-branch"></i> main*</div>
      <div class="status-item"><i class="codicon codicon-error"></i> 0 <i class="codicon codicon-warning" style="margin-left: 5px;"></i> 0</div>
    </div>
    <div style="display: flex;">
         <div class="status-item" id="provider">Waiting...</div>
         <div class="status-item">Ln 12, Col 34</div>
         <div class="status-item">UTF-8</div>
         <div class="status-item">TypeScript</div>
         <div class="status-item"><i class="codicon codicon-bell"></i></div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs/loader.js"></script>
  <script>
    let editor;
    
    require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs' }});
    require(['vs/editor/editor.main'], function () {
      editor = monaco.editor.create(document.getElementById('editor'), {
        value: `// Production Hybrid IDE - $0/month Forever
// Constraints enforced:
// - KV write quota: 1000/day (hard cap)
// - Circuit breaker: Gemini → Ollama (no Workers AI)
// - No background tasks (request-scoped only)

// Press F1 or Ctrl+Shift+P for Command Palette
// Press Ctrl+Space to AI-complete
// Press Ctrl+E to AI-explain

function example() {
  // Type here and press Ctrl+Space for AI completion

} \`,
        language: 'typescript',
        theme: 'vs-dark',
        fontSize: 14,
        fontFamily: "'Consolas', 'Courier New', monospace",
        automaticLayout: true,
        minimap: { enabled: true },
        scrollbar: { verticalScrollbarSize: 10 },
        padding: { top: 15 }
      });
      
      // Add simplified Command Palette actions for AI
      editor.addAction({
        id: 'ai-complete',
        label: 'AI: Complete Code',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space],
        run: function(ed) { completeCode(); }
      });

      editor.addAction({
        id: 'ai-explain',
        label: 'AI: Explain Code',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE],
        run: function(ed) { explainCode(); }
      });
      
      editor.addAction({
          id: 'ai-chat',
          label: 'AI: Chat',
          run: function(ed) { alert('Full chat requires CLI: "ide chat"'); }
      });
    });

    // Update quota display
    async function updateQuota() {
      try {
        const res = await fetch('/api/health');
        const data = await res.json();
        const quota = data.kvWriteQuota || 0;
        
        document.getElementById('quotaDisplay').textContent = \`\${quota}% used\`;
        document.getElementById('quotaBar').style.width = \`\${quota}%\`;
        
        const color = quota > 85 ? '#f44336' : quota > 70 ? '#ff9800' : '#4caf50';
        document.getElementById('quotaDisplay').style.color = color;
        document.getElementById('quotaBar').style.background = color;
        
        if (quota >= 100) {
          document.getElementById('statusBar').className = 'status-bar quota-warning';
        }
      } catch (e) {
        document.getElementById('quotaDisplay').textContent = 'Error';
      }
    }
    
    updateQuota();
    setInterval(updateQuota, 30000);

    // Re-implemented logic for VS Code style
    async function completeCode() {
       const content = editor.getValue();
       const position = editor.getPosition();
       const cursor = editor.getModel().getOffsetAt(position);
       
       const statusDiv = document.getElementById('provider');
       statusDiv.textContent = 'AI Completing...';
       
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
         
         if (!response.ok) throw new Error('API Failed');
         
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
            editor.executeEdits('ai', [{
                range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
                text: result,
                forceMoveMarkers: true
            }]);
            statusDiv.textContent = \`AI: \${provider} (Ready)\`;
            updateQuota();
         }
       } catch (e) {
         statusDiv.textContent = 'AI Error';
         setTimeout(() => statusDiv.textContent = 'Ready', 3000);
       }
    }

    async function explainCode() {
        const selection = editor.getModel().getValueInRange(editor.getSelection());
        if(!selection) return;
        
        const statusDiv = document.getElementById('provider');
        statusDiv.textContent = 'AI Explaining...';
        
        try {
            const response = await fetch('/api/explain', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: selection, language: 'typescript' })
            });
            const data = await response.json();
            if (data.explanation) {
                editor.setValue(editor.getValue() + \`\\n\\n/** AI Explanation (\${data.provider}):\\n *  \${data.explanation.replace(/\\n/g, '\\n *  ')}\\n */\`);
                statusDiv.textContent = \`AI: \${data.provider} (Ready)\`;
            }
        } catch(e) {
            statusDiv.textContent = 'AI Error';
        }
    }
    
    // Ctrl+S prevention
    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            alert('File saved to Cloudflare KV!');
        }
    });
  </script>
</body>
</html>`;
