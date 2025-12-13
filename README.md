# Cloudflare Code Agent

A serverless reasoning engine that interprets coding tasks and produces verifiable code artifacts.

## API Contract

### POST /agent/run

**Request:**
```json
{
  "sessionId": "uuid",
  "input": "Fix TS1005 in opcode_reader.ts",
  "files": {
    "opcode_reader.ts": "function foo() { return 1; }"
  },
  "options": {
    "output": "diff",
    "auto": true
  }
}
```

**Response (Success):**
```json
{
  "intent": "implement",
  "plan": ["Apply requested change"],
  "artifact": "diff --git a/opcode_reader.ts b/opcode_reader.ts\n..."
}
```

**Response (Error):**
```json
{
  "intent": "implement",
  "plan": ["Apply requested change"],
  "error": {
    "type": "context",
    "message": "Context mismatch",
    "details": "File: a.ts, near line 1, expected: \"function foo() {}\""
  }
}
```

## Scripts

```bash
# Development
npm run dev              # Start local dev server
npm run deploy           # Deploy to production

# Testing
npm run test             # Run full test matrix
npm test:unit            # Run unit tests (Deno)

# Infrastructure
npm run kv:create        # Create KV namespace (once)
```

## Test Matrix

```bash
# Happy path
curl -X POST http://localhost:8787/agent/run \
  -d '{"sessionId":"test","input":"Rename foo to bar","files":{"a.ts":"function foo() {}"}}'

# Expected failure (no diff markers)
curl -X POST http://localhost:8787/agent/run \
  -d '{"sessionId":"test","input":"Say hello","files":{"a.ts":""}}'
```

## Architecture

- **Validator**: Three-stage execution gate (structure → parse → context)
- **Retry Loop**: One retry with stage-aware corrective feedback
- **Intent Caching**: Per-session KV store to prevent oscillation
- **Model**: Treated as untrusted diff generator

## Key Decisions

- All failures funnel through the same retry path
- Validation is pure and deterministic
- No prose leaks; only diffs or structured errors
- Forward scan tolerance (5 lines) for context fuzz
