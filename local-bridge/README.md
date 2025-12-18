# Local Bridge Server

Connects the Cloudflare Code Agent Web IDE to your local filesystem.

## Installation

### Option 1: Global Install (Recommended)
```bash
cd local-bridge
npm run install-global
```

Now use from anywhere:
```bash
# Start in current directory
bridge-start

# Start in specific directory
bridge-start C:\path\to\project
bridge-start ~/code/my-app
```

### Option 2: Local Usage

```bash
cd local-bridge
npm install
npm start
```

The bridge runs on `http://localhost:3030` and serves files from the current directory.

## Configuration

### Change Workspace Directory
```bash
# Windows
set WORKSPACE_ROOT=C:\path\to\your\project
npm start

# Linux/Mac
WORKSPACE_ROOT=/path/to/your/project npm start
```

## How It Works

1. **Auto-Detection**: The Web IDE pings `localhost:3030/health` on load
2. **Routing**: If detected, all FS/Terminal calls route through the bridge
3. **Fallback**: If unavailable, falls back to R2 cloud storage

## Security

- Directory traversal protection enabled
- Default ignore patterns (node_modules, .git, etc.)
- CORS restricted to localhost origins

## Endpoints

- `GET /health` - Health check
- `GET /api/fs/list` - List all files
- `GET /api/fs/file?name=<path>` - Read file
- `POST /api/fs/file` - Write file
- `DELETE /api/fs/file` - Delete file
- `POST /api/terminal` - Execute command
