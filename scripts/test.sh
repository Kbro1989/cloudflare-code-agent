#!/bin/bash
BASE_URL="${BASE_URL:-http://localhost:8787}"

test_case() {
  echo "Test: $1"
  response=$(curl -s -X POST "$BASE_URL/agent/run" \
    -H "Content-Type: application/json" \
    -d "$2")
  echo "$response" | jq .
  echo ""
}

# Happy path
test_case "Rename function" '{"sessionId":"test-1","input":"Rename foo to bar","files":{"a.ts":"function foo() {}"}}'

# Structure fail (no markers)
test_case "No markers" '{"sessionId":"test-2","input":"Say hello","files":{"a.ts":""}}'

# Parse fail (invalid hunk)
test_case "Invalid hunk" '{"sessionId":"test-3","input":"Return gibberish","files":{"a.ts":""}}'

# Allowlist fail (wrong file)
test_case "Unauthorized file" '{"sessionId":"test-4","input":"Modify b.ts","files":{"a.ts":""}}'

# Context fuzz (should succeed)
test_case "Context fuzz tolerance" '{"sessionId":"test-5","input":"Add comment above function","files":{"a.ts":"function foo() {\n  return 1;\n}"}}'
