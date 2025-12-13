export const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cloudflare Code Agent | Playground</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-dark: #0f1117;
            --bg-card: #161b22;
            --border: #30363d;
            --accent: #f48120;
            --text-primary: #e6edf3;
            --text-secondary: #8b949e;
            --font-main: 'Inter', system-ui, -apple-system, sans-serif;
            --font-mono: 'JetBrains Mono', monospace;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            background-color: var(--bg-dark);
            color: var(--text-primary);
            font-family: var(--font-main);
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }

        header {
            border-bottom: 1px solid var(--border);
            padding: 1rem 1.5rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(15, 17, 23, 0.8);
            backdrop-filter: blur(10px);
        }

        .brand {
            font-weight: 600;
            font-size: 1.1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .brand svg { width: 24px; height: 24px; color: var(--accent); }

        .container {
            flex: 1;
            display: grid;
            grid-template-columns: 1fr 1fr;
            overflow: hidden;
        }

        .panel {
            display: flex;
            flex-direction: column;
            border-right: 1px solid var(--border);
            min-height: 0;
            background: var(--bg-card);
        }

        .panel:last-child { border-right: none; background: var(--bg-dark); }

        .panel-header {
            padding: 0.75rem 1rem;
            border-bottom: 1px solid var(--border);
            font-size: 0.85rem;
            font-weight: 500;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .editor-container {
            flex: 1;
            padding: 1rem;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }

        .input-group {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }

        label { font-size: 0.9rem; font-weight: 500; color: var(--text-secondary); }

        input, textarea, select {
            background: #0d1117;
            border: 1px solid var(--border);
            color: var(--text-primary);
            padding: 0.75rem;
            border-radius: 6px;
            font-family: var(--font-mono);
            font-size: 0.9rem;
            resize: vertical;
            transition: border-color 0.2s;
        }

        input:focus, textarea:focus {
            outline: none;
            border-color: var(--accent);
        }

        .file-entry {
            border: 1px solid var(--border);
            border-radius: 6px;
            overflow: hidden;
            margin-bottom: 0.5rem;
        }

        .file-header {
            background: #21262d;
            padding: 0.5rem;
            display: flex;
            gap: 0.5rem;
        }

        .file-header input {
            padding: 0.25rem 0.5rem;
            flex: 1;
        }

        .file-body textarea {
            width: 100%;
            border: none;
            min-height: 120px;
            border-radius: 0;
        }

        button.primary {
            background: var(--accent);
            color: white;
            border: none;
            padding: 0.75rem;
            border-radius: 6px;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.2s;
        }

        button.primary:hover { opacity: 0.9; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }

        #result {
            flex: 1;
            padding: 1rem;
            white-space: pre-wrap;
            font-family: var(--font-mono);
            font-size: 0.85rem;
            color: #d2a8ff; /* Diff additions in purple/pinkish */
            overflow-y: auto;
        }

        .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: var(--text-secondary);
            gap: 0.5rem;
            display: none;
        }

        .loading.active { display: flex; }

        /* Diff styling simple approximations */
        .diff-added { color: #56d364; }
        .diff-removed { color: #f85149; }
        .diff-header { color: #79c0ff; font-weight: bold; }

    </style>
</head>
<body>
    <header>
        <div class="brand">
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.4 4.6l-5-4.3a2 2 0 00-2.8 0l-5 4.3a2 2 0 00-.7 1.5v3.3h-3a2 2 0 00-2 2v9a2 2 0 002 2h18a2 2 0 002-2v-9a2 2 0 00-2-2h-3V6.1a2 2 0 00-.7-1.5zM8 7v2h8V7l-4-3.4L8 7zm-5 13v-7h18v7H3z"/>
            </svg>
            Cloudflare Code Agent
        </div>
        <div>
            <span style="font-size: 0.8rem; color: var(--text-secondary);">v1.0.0</span>
        </div>
    </header>

    <div class="container">
        <div class="panel">
            <div class="panel-header">Task Definition</div>
            <div class="editor-container">
                <div class="input-group">
                    <label>Instruction</label>
                    <textarea id="input" rows="3" placeholder="e.g. Rename foo to bar"></textarea>
                </div>
                
                <div class="input-group">
                    <label>Files</label>
                    <div id="file-list">
                        <div class="file-entry">
                            <div class="file-header">
                                <input type="text" value="main.ts" class="file-name">
                            </div>
                            <div class="file-body">
                                <textarea class="file-content">function foo() {
  console.log("hello world");
}</textarea>
                            </div>
                        </div>
                    </div>
                </div>

                <div style="margin-top: auto;">
                    <button class="primary" id="run-btn" style="width: 100%">Run Agent</button>
                    <div id="status" style="margin-top: 0.5rem; font-size: 0.8rem; text-align: center; color: var(--text-secondary);"></div>
                </div>
            </div>
        </div>

        <div class="panel">
            <div class="panel-header">Agent Output (Diff)</div>
            <div class="loading" id="loader">Processing...</div>
            <div id="result"></div>
        </div>
    </div>

    <script>
        const runBtn = document.getElementById('run-btn');
        const inputField = document.getElementById('input');
        const statusDiv = document.getElementById('status');
        const resultDiv = document.getElementById('result');
        const loader = document.getElementById('loader');

        runBtn.addEventListener('click', async () => {
            const input = inputField.value.trim();
            if (!input) return alert("Please enter an instruction");

            // Collect files
            const files = {};
            document.querySelectorAll('.file-entry').forEach(entry => {
                const name = entry.querySelector('.file-name').value;
                const content = entry.querySelector('.file-content').value;
                if (name && content) files[name] = content;
            });

            // UI State
            runBtn.disabled = true;
            loader.classList.add('active');
            resultDiv.innerHTML = '';
            statusDiv.textContent = "Agent is thinking...";

            try {
                const res = await fetch('/agent/run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sessionId: crypto.randomUUID(),
                        input,
                        files
                    })
                });

                const data = await res.json();
                
                if (data.error) {
                    resultDiv.textContent = JSON.stringify(data.error, null, 2);
                    statusDiv.textContent = "Error occurred";
                } else {
                    const artifact = data.artifact || "No changes proposed.";
                    resultDiv.innerHTML = formatDiff(artifact);
                    statusDiv.textContent = \`Success (Intent: \${data.intent})\`;
                }

            } catch (e) {
                resultDiv.textContent = e.message;
                statusDiv.textContent = "Network error";
            } finally {
                runBtn.disabled = false;
                loader.classList.remove('active');
            }
        });

        function formatDiff(diff) {
            // Basic syntax highlighting for diffs
            return diff.split('\\n').map(line => {
                if (line.startsWith('+')) return \`<div class="diff-added">\${escape(line)}</div>\`;
                if (line.startsWith('-')) return \`<div class="diff-removed">\${escape(line)}</div>\`;
                if (line.startsWith('diff')) return \`<div class="diff-header">\${escape(line)}</div>\`;
                return \`<div>\${escape(line)}</div>\`;
            }).join('');
        }

        function escape(str) {
            return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        }
    </script>
</body>
</html>
`;
