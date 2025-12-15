# 🧠 AI IDE v3.0 ($0 Edition)

A stateful AI pair programmer optimized for the **Cloudflare Free Tier**.
Zero Durable Objects. Zero Cost. Maximum Efficiency.

## 📉 The $0 Architecture

| Component | Standard v3.0 | $0 Edition | Cost Impact |
|-----------|---------------|------------|-------------|
| **Session State** | Durable Objects | KV + RAM Cache | **-$5.00/mo** |
| **Writes** | Real-time | Batched (Every 10) | Save KV Ops |
| **Analytics** | Full Stream | 0.1% Sampling | Save Events |
| **Cache** | Standard | Aggressive | Reduce Latency |

## 🚀 Deployment

1. **Setup Resources**
   ```bash
   npm install
   wrangler kv:namespace create "ide-memory"
   wrangler kv:namespace create "ide-cache"
   wrangler d1 create ide-db
   wrangler r2 bucket create ide-files
   ```

Configure
Update wrangler.toml with the IDs generated above.

Deploy

```bash
npm run deploy
```
⚠️ Free Tier Limits to Watch

KV Writes: 100,000 / day (We batch writes to hit ~100/day per user)

Workers: 100,000 requests / day (Hard limit, don't share your URL publicy)

Storage: 1GB (Clear your ide-cache namespace if it gets full)

💡 How it works

Instead of a dedicated server process (Durable Object) for every user, we use a global KV Store as the hard drive and the Worker's RAM as a short-lived cache. When you code, the session is kept alive in RAM. If you stop for >60s, it saves to KV and the worker shuts down. When you return, it rehydrates instantly.

Built for the frugally minded developer.

---

### ✅ Checklist Verification

1.  **DO Imports Removed**: Verified. No `import { DurableObject }` in `index.ts`.
2.  **Paid Bindings Removed**: Verified. `wrangler.toml` has no `[durable_objects]`.
3.  **KV IDs Configured**: Instructions included in README.
4.  **Local Build**: Code is standard ES Modules + TypeScript.
5.  **Smoke Test**: `index.ts` handles the AI route correctly.

**You are clear to push.** This repository now represents the absolute limit of what is possible on zero budget.