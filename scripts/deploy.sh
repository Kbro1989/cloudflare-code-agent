#!/bin/bash
# PRODUCTION HYBRID IDE DEPLOYMENT - 100% LOCKED
# Enforces: Secret leak detection, KV quota limits, no Workers AI

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo -e "${CYAN}🚀 PRODUCTION HYBRID IDE DEPLOYMENT${NC}"
echo -e "${CYAN}═══════════════════════════════════════════${NC}\n"

# Phase 0: Secret Leak Detection (CRITICAL - FAILS if secrets found)
echo -e "${GREEN}Phase 0: Secret Leak Detection${NC}"
echo "Scanning for secrets in source code..."

# Check worker
if [ -d "worker/src" ]; then
    if grep -rE "GEMINI_API_KEY|OLLAMA_AUTH_TOKEN|AIza[A-Za-z0-9_-]{35}" worker/src/ 2>/dev/null; then
        echo -e "${RED}❌ SECRET LEAK DETECTED IN worker/src/${NC}"
        echo -e "${RED}Secrets must ONLY be set via: wrangler secret put <NAME>${NC}"
        echo -e "${RED}NEVER commit secrets to source code${NC}"
        exit 1
    fi
fi

# Check CLI
if [ -d "cli/src" ]; then
    if grep -rE "GEMINI_API_KEY|OLLAMA_AUTH_TOKEN|AIza[A-Za-z0-9_-]{35}" cli/src/ 2>/dev/null; then
        echo -e "${RED}❌ SECRET LEAK DETECTED IN cli/src/${NC}"
        echo -e "${RED}Remove secrets from source code${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✅ No secrets found in source code${NC}\n"

# Phase 1: Prerequisites Check
echo -e "${GREEN}Phase 1: Prerequisites Check${NC}"

if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ Wrangler not found${NC}"
    echo "Install: npm install -g wrangler"
    exit 1
fi
echo -e "${GREEN}✅ Wrangler installed${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found${NC}"
    echo "Install from: https://nodejs.org"
    exit 1
fi
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}❌ Node.js 18+ required (current: $NODE_VERSION)${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Node.js $(node --version)${NC}"

if ! wrangler whoami &> /dev/null; then
    echo -e "${YELLOW}⚠️  Not logged into Cloudflare${NC}"
    echo "Run: wrangler login"
    exit 1
fi
echo -e "${GREEN}✅ Cloudflare authenticated${NC}"

echo ""

# Phase 2: Worker Deployment
echo -e "${GREEN}Phase 2: Worker Deployment${NC}"

if [ ! -d "worker" ]; then
    echo -e "${RED}❌ worker/ directory not found${NC}"
    exit 1
fi

cd worker

# Create package.json if missing
if [ ! -f "package.json" ]; then
    echo "Creating package.json..."
    cat > package.json << 'EOF'
{
  "name": "hybrid-ide-worker",
  "version": "1.0.0",
  "description": "Production Hybrid IDE Worker - $0/month forever",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "tail": "wrangler tail"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20231218.0",
    "typescript": "^5.3.3",
    "wrangler": "^3.22.0"
  }
}
EOF
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Create KV namespaces (check if they exist first)
echo ""
echo "Creating KV namespaces..."

# List existing namespaces
EXISTING_NAMESPACES=$(wrangler kv:namespace list 2>/dev/null || echo "")

# Create CACHE namespace if not exists
if echo "$EXISTING_NAMESPACES" | grep -q "hybrid-ide-cache"; then
    CACHE_ID=$(echo "$EXISTING_NAMESPACES" | grep "hybrid-ide-cache" | grep -oP 'id = "\K[^"]+' | head -1)
    echo "Using existing CACHE namespace: $CACHE_ID"
else
    echo "Creating CACHE namespace..."
    CACHE_OUTPUT=$(wrangler kv:namespace create CACHE 2>&1)
    CACHE_ID=$(echo "$CACHE_OUTPUT" | grep -oP 'id = "\K[^"]+' || echo "")
    if [ -z "$CACHE_ID" ]; then
        echo -e "${RED}❌ Failed to create CACHE namespace${NC}"
        exit 1
    fi
    echo "Created CACHE namespace: $CACHE_ID"
fi

# Create MEMORY namespace if not exists
if echo "$EXISTING_NAMESPACES" | grep -q "hybrid-ide-memory"; then
    MEMORY_ID=$(echo "$EXISTING_NAMESPACES" | grep "hybrid-ide-memory" | grep -oP 'id = "\K[^"]+' | head -1)
    echo "Using existing MEMORY namespace: $MEMORY_ID"
else
    echo "Creating MEMORY namespace..."
    MEMORY_OUTPUT=$(wrangler kv:namespace create MEMORY 2>&1)
    MEMORY_ID=$(echo "$MEMORY_OUTPUT" | grep -oP 'id = "\K[^"]+' || echo "")
    if [ -z "$MEMORY_ID" ]; then
        echo -e "${RED}❌ Failed to create MEMORY namespace${NC}"
        exit 1
    fi
    echo "Created MEMORY namespace: $MEMORY_ID"
fi

# Update wrangler.toml with KV IDs
if [ -f "wrangler.toml.backup" ]; then
    cp wrangler.toml.backup wrangler.toml
else
    cp wrangler.toml wrangler.toml.backup
fi

sed -i.tmp "s/REPLACE_WITH_CACHE_KV_ID/${CACHE_ID}/" wrangler.toml
sed -i.tmp "s/REPLACE_WITH_MEMORY_KV_ID/${MEMORY_ID}/" wrangler.toml
rm -f wrangler.toml.tmp

echo -e "${GREEN}✅ KV namespaces configured${NC}"

# Set secrets
echo ""
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo -e "${CYAN}🔑 SECRET CONFIGURATION${NC}"
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo ""
echo "Get your Gemini API key from:"
echo -e "${CYAN}👉 https://makersuite.google.com/app/apikey${NC}"
echo ""
echo -e "${YELLOW}⚠️  Your input will not be echoed (secure)${NC}"
read -s -p "Enter Gemini API key: " GEMINI_KEY
echo ""

if [ -z "$GEMINI_KEY" ]; then
    echo -e "${RED}❌ Gemini API key required${NC}"
    exit 1
fi

# Validate Gemini key format
if [[ ! "$GEMINI_KEY" =~ ^AIza[A-Za-z0-9_-]{35}$ ]]; then
    echo -e "${YELLOW}⚠️  Warning: API key format looks unusual${NC}"
    read -p "Continue anyway? (y/n): " CONTINUE
    if [ "$CONTINUE" != "y" ]; then
        exit 1
    fi
fi

echo "$GEMINI_KEY" | wrangler secret put GEMINI_API_KEY
echo -e "${GREEN}✅ Gemini API key set${NC}"

# Optional: Ollama (for unlimited local AI)
echo ""
read -p "Configure Ollama fallback? (y/n): " HAS_OLLAMA

if [ "$HAS_OLLAMA" = "y" ]; then
    if ! command -v ollama &> /dev/null; then
        echo -e "${YELLOW}⚠️  Ollama not found${NC}"
        read -p "Install Ollama now? (y/n): " INSTALL_OLLAMA
        
        if [ "$INSTALL_OLLAMA" = "y" ]; then
            echo "Installing Ollama..."
            curl -fsSL https://ollama.ai/install.sh | sh
            echo -e "${GREEN}✅ Ollama installed${NC}"
        else
            echo -e "${YELLOW}⏭️  Skipping Ollama setup${NC}"
            HAS_OLLAMA="n"
        fi
    fi
    
    if [ "$HAS_OLLAMA" = "y" ]; then
        read -p "Ollama URL (default: http://localhost:11434): " OLLAMA_URL
        OLLAMA_URL=${OLLAMA_URL:-http://localhost:11434}
        
        echo "$OLLAMA_URL" | wrangler secret put OLLAMA_URL
        echo -e "${GREEN}✅ Ollama URL set${NC}"
        
        read -p "Ollama requires auth token? (y/n): " NEEDS_TOKEN
        if [ "$NEEDS_TOKEN" = "y" ]; then
            read -s -p "Enter Ollama auth token: " OLLAMA_TOKEN
            echo ""
            echo "$OLLAMA_TOKEN" | wrangler secret put OLLAMA_AUTH_TOKEN
            echo -e "${GREEN}✅ Ollama token set${NC}"
        fi
        
        # Pull recommended model
        echo ""
        read -p "Pull qwen2.5-coder:7b model? (recommended, y/n): " PULL_MODEL
        if [ "$PULL_MODEL" = "y" ]; then
            echo "Pulling model (this may take a few minutes)..."
            ollama pull qwen2.5-coder:7b
            echo -e "${GREEN}✅ Model downloaded${NC}"
        fi
    fi
fi

# Deploy worker
echo ""
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo -e "${CYAN}🚀 Deploying Worker${NC}"
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo ""

wrangler deploy

# Get worker URL
WORKER_URL=$(wrangler deployments list --json 2>/dev/null | grep -oP '"url":"\K[^"]+' | head -1 || echo "")

if [ -z "$WORKER_URL" ]; then
    echo -e "${YELLOW}⚠️  Could not auto-detect worker URL${NC}"
    read -p "Enter your worker URL: " WORKER_URL
fi

echo ""
echo -e "${GREEN}✅ Worker deployed successfully!${NC}"
echo -e "${CYAN}   URL: $WORKER_URL${NC}"

cd ..

# Phase 3: CLI Installation
echo ""
echo -e "${GREEN}Phase 3: CLI Installation${NC}"

if [ ! -d "cli" ]; then
    echo -e "${RED}❌ cli/ directory not found${NC}"
    exit 1
fi

cd cli

# Create package.json if missing
if [ ! -f "package.json" ]; then
    echo "Creating CLI package.json..."
    cat > package.json << 'EOF'
{
  "name": "@hybrid-ide/cli",
  "version": "1.0.0",
  "description": "Production Hybrid IDE CLI - $0/month",
  "bin": {
    "ide": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "ts-node src/index.ts"
  },
  "dependencies": {
    "commander": "^11.1.0",
    "chalk": "^4.1.2",
    "ora": "^5.4.1",
    "inquirer": "^8.2.6"
  },
  "devDependencies": {
    "@types/node": "^20.10.5",
    "@types/inquirer": "^8.2.10",
    "typescript": "^5.3.3",
    "ts-node": "^10.9.2"
  }
}
EOF
fi

# Create tsconfig.json if missing
if [ ! -f "tsconfig.json" ]; then
    cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
EOF
fi

echo "Installing CLI dependencies..."
npm install

echo "Building CLI..."
npm run build

# Add shebang if missing
if [ -f "dist/index.js" ] && ! head -1 dist/index.js | grep -q "^#!"; then
    echo "Adding shebang..."
    echo '#!/usr/bin/env node' | cat - dist/index.js > dist/index.js.tmp
    mv dist/index.js.tmp dist/index.js
    chmod +x dist/index.js
fi

echo "Installing CLI globally..."
npm link

echo -e "${GREEN}✅ CLI installed successfully!${NC}"

cd ..

# Phase 4: Configuration
echo ""
echo -e "${GREEN}Phase 4: IDE Configuration${NC}"
echo "Initializing IDE..."

# Run ide init
ide init <<EOF
$WORKER_URL
default
EOF

echo -e "${GREEN}✅ IDE configured${NC}"

# Phase 5: Verification
echo ""
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo -e "${CYAN}✅ DEPLOYMENT VERIFICATION${NC}"
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo ""

echo "Running health check..."
ide doctor

echo ""
echo "Checking status..."
ide status

# Success!
echo ""
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo -e "${CYAN}🎉 DEPLOYMENT COMPLETE!${NC}"
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo ""
echo -e "${GREEN}✅ Worker:${NC} $WORKER_URL"
echo -e "${GREEN}✅ CLI:${NC} ide command available"
echo -e "${GREEN}✅ Cost:${NC} \$0/month (enforced)"
echo ""
echo -e "${CYAN}Quick Test:${NC}"
echo "  1. Create test file: echo 'function add(a, b) {' > test.js"
echo "  2. Complete it: ide complete test.js"
echo "  3. Check quota: ide status"
echo ""
echo -e "${CYAN}Documentation:${NC}"
echo "  Web IDE: $WORKER_URL"
echo "  Commands: ide --help"
echo "  Status: ide status"
echo "  Chat: ide chat"
echo ""
echo -e "${CYAN}Constraints Enforced:${NC}"
echo "  ✅ KV write quota: 1000/day (hard cap)"
echo "  ✅ No secret leaks (grep-checked)"
echo "  ✅ Circuit breaker: Gemini → Ollama only"
echo "  ✅ No Workers AI (no paid fallback)"
echo "  ✅ Request-scoped only (no background tasks)"
echo ""
echo -e "${GREEN}🎊 Your $0/month production IDE is ready!${NC}"
echo ""
