import { ProjectMemory, SessionMemory, AICompleteArgs, FileSaveArgs, Pattern, ModelConfig } from '../memory/types';
import { MemoryManager } from '../memory/storage';

interface Env {
  MEMORY: KVNamespace;
  CACHE: KVNamespace;
  ANALYTICS?: AnalyticsEngineDataset;
  OLLAMA_URL: string;
}

const MODELS: Record<string, ModelConfig> = {
  high: { name: 'llama3:70b', tier: 'high', maxTokens: 500, temperature: 0.15 },
  medium: { name: 'qwen2.5:7b', tier: 'medium', maxTokens: 300, temperature: 0.2 },
  low: { name: 'codellama:7b-code', tier: 'low', maxTokens: 200, temperature: 0.25 }
};

// Global RAM Cache with LRU behavior
const SESSION_CACHE = new Map<string, { data: SessionMemory; expires: number }>();
const MAX_CACHE_SIZE = 50; // Strict limit to prevent OOM on small isolates

export class KVSessionManager {
  private memoryManager: MemoryManager;

  constructor(private env: Env) {
    this.memoryManager = new MemoryManager(env);
  }

  async handleAIComplete(args: AICompleteArgs): Promise<Response> {
    const session = await this.getSession(args.projectId, args.sessionId);
    // Hydrate project memory (with fallback if KV is slow/empty)
    const project = await this.memoryManager.getProjectMemory(args.projectId) || this.initProject(args.projectId);
    
    session.currentFile = args.fileId;
    session.meta.lastActivity = Date.now();

    const context = {
      project: { type: project.type, conventions: project.conventions },
      session: { recentEdits: session.recentEdits.slice(-3), task: session.currentTask },
      patterns: this.getRelevantPatterns(project, args.code, args.language)
    };

    const prompt = this.constructPrompt(context, args.code, args.cursor, args.language);
    const promptHash = await this.sha256(prompt);
    
    // 1. Aggressive Cache Check (KV)
    const cached = await this.memoryManager.getCachedCompletion(promptHash);
    if (cached) {
      this.recordCompletion(project, session, 0, 0, true);
      return Response.json({ completion: cached, cached: true, tier: 'cache' });
    }

    // 2. AI Generation
    const start = Date.now();
    const completion = await this.getAICompletion(prompt, args.language);
    const duration = Date.now() - start;
    const tokens = Math.ceil((prompt.length + completion.length) / 4);

    // 3. Update State
    this.extractPatterns(project, args.code);
    await this.memoryManager.cacheCompletion(promptHash, completion);
    this.recordCompletion(project, session, duration, tokens, false);

    // 4. Save Strategy ($0 Optimization)
    // Only write to KV every 10 completions or if significant time passed
    if (session.meta.completions % 10 === 0) {
      await this.saveSession(session); // Sync Session
      await this.memoryManager.saveProjectMemory(project); // Sync Project
    } else {
      // Just update RAM cache for speed
      this.updateCache(session);
    }

    return Response.json({ 
      completion, 
      cached: false, 
      tier: this.getModelForLanguage(args.language).tier, 
      tokens 
    });
  }

  async handleFileSave(args: FileSaveArgs): Promise<Response> {
    const session = await this.getSession(args.projectId, args.sessionId);
    session.recentEdits.push({
      fileId: args.fileId, filePath: args.filePath, timestamp: Date.now(),
      summary: `Lines: ${args.code.split('\n').length}`, changedLines: args.code.split('\n').length
    });
    if (session.recentEdits.length > 10) session.recentEdits.shift();
    
    // Always persist on save (users expect saves to be durable)
    await this.saveSession(session);
    return Response.json({ ok: true });
  }

  // --- Internals ---

  private async getSession(pid: string, sid: string): Promise<SessionMemory> {
    const key = `${pid}:${sid}`;
    const cached = SESSION_CACHE.get(key);
    if (cached && cached.expires > Date.now()) return cached.data;

    const stored = await this.env.MEMORY.get(`session:${key}`, { type: 'json' });
    if (stored) {
      const s = stored as SessionMemory;
      this.updateCache(s);
      return s;
    }
    return { projectId: pid, sessionId: sid, activeFiles: [], recentEdits: [], workingMemory: [], tempPatterns: {}, meta: { started: Date.now(), lastActivity: Date.now(), completions: 0 } };
  }

  private updateCache(s: SessionMemory) {
    const key = `${s.projectId}:${s.sessionId}`;
    // LRU Protection
    if (SESSION_CACHE.size >= MAX_CACHE_SIZE) {
        const oldest = SESSION_CACHE.keys().next().value;
        SESSION_CACHE.delete(oldest!);
    }
    SESSION_CACHE.set(key, { data: s, expires: Date.now() + 300000 }); // 5m RAM TTL
  }

  private async saveSession(s: SessionMemory): Promise<void> {
    const key = `${s.projectId}:${s.sessionId}`;
    this.updateCache(s);
    // Explicit await to ensure write completes before response (safer for $0)
    await this.env.MEMORY.put(`session:${key}`, JSON.stringify(s), { expirationTtl: 86400 }); // 24h TTL
  }

  private initProject(id: string): ProjectMemory {
    return { id, name: id, type: 'unknown', bootstrapped: false, patterns: {}, conventions: { naming: [], structure: [], imports: [], errorHandling: [], patterns: [] }, entities: {}, relationships: {}, learnings: [], stats: { completions: 0, cacheHits: 0, tokensUsed: 0, avgDuration: 0, lastCompletion: 0 }, meta: { created: Date.now(), lastUpdated: Date.now(), lastSession: 0 } };
  }

  private async getAICompletion(prompt: string, language: string): Promise<string> {
    const model = this.getModelForLanguage(language);
    try {
      const res = await fetch(`${this.env.OLLAMA_URL}/api/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.name, prompt, stream: false, options: { temperature: model.temperature, num_predict: model.maxTokens, stop: ['\n\n', '```'] } })
      });
      if (!res.ok) throw new Error('AI Error');
      const data = await res.json() as any;
      return data.response;
    } catch { return ''; }
  }

  private getModelForLanguage(language: string): ModelConfig {
    if (['rust', 'cpp', 'sql'].includes(language)) return MODELS.high;
    if (['typescript', 'go'].includes(language)) return MODELS.medium;
    return MODELS.low;
  }

  private extractPatterns(proj: ProjectMemory, code: string) {
    if (code.includes('useState')) {
        const id = 'react-hook';
        if(!proj.patterns[id]) proj.patterns[id] = { id, name: 'Hook', template: 'useState', type: 'component', usageCount: 0, confidence: 0.5, examples: [], firstSeen: Date.now(), lastUsed: 0 };
        proj.patterns[id].usageCount++;
    }
  }

  private getRelevantPatterns(proj: ProjectMemory, code: string, lang: string): Pattern[] {
    return Object.values(proj.patterns).sort((a,b)=>b.usageCount-a.usageCount).slice(0,3);
  }

  private constructPrompt(ctx: any, code: string, cursor: number, language: string): string {
     return `Complete ${language} code at <CURSOR>:\n${code.substring(Math.max(0,cursor-500),cursor)}<CURSOR>`;
  }

  private recordCompletion(p: ProjectMemory, s: SessionMemory, dur: number, tok: number, cached: boolean) {
    p.stats.completions++; s.meta.completions++;
    // Analytics Sampling (0.1%)
    if (Math.random() < 0.001 && this.env.ANALYTICS) {
       this.env.ANALYTICS.writeDataPoint({ blobs: [s.sessionId, cached?'cache':'ai'], doubles: [dur, tok], indexes: [p.id] });
    }
  }

  private async sha256(str: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
}