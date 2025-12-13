export function renderHtml(env: any): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hello-AI Editor</title>
    <style>
        :root {
            --glass-bg: rgba(255, 255, 255, 0.05);
            --glass-border: rgba(255, 255, 255, 0.1);
            --accent: #00f2ea;
            --accent-glow: rgba(0, 242, 234, 0.5);
            --text-primary: #ffffff;
            --text-secondary: #a0a0a0;
        }

        body {
            margin: 0;
            overflow: hidden;
            background: radial-gradient(circle at 50% 50%, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            color: var(--text-primary);
        }

        #canvas-container {
            width: 100vw;
            height: 100vh;
            position: absolute;
            top: 0;
            left: 0;
            z-index: 1;
        }

        .ui-layer {
            position: absolute;
            z-index: 10;
            padding: 24px;
            pointer-events: none; /* Let clicks pass through to canvas where empty */
            width: 100%;
            height: 100%;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            pointer-events: auto;
        }

        .brand {
            font-size: 1.5rem;
            font-weight: 700;
            background: linear-gradient(to right, #fff, var(--accent));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            text-shadow: 0 0 20px var(--accent-glow);
        }

        .controls {
            background: var(--glass-bg);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid var(--glass-border);
            border-radius: 16px;
            padding: 20px;
            width: 280px;
            pointer-events: auto;
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
        }

        .control-group {
            margin-bottom: 20px;
        }

        .control-label {
            display: block;
            margin-bottom: 8px;
            font-size: 0.85rem;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .color-picker {
            width: 100%;
            height: 40px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            background: none;
        }

        button {
            width: 100%;
            padding: 12px;
            border: none;
            border-radius: 8px;
            background: linear-gradient(135deg, var(--accent) 0%, #00d2ff 100%);
            color: #000;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 0 20px var(--accent-glow);
        }

        button:active {
            transform: translateY(0);
        }

        /* Sidebar Styles */
        .sidebar {
            position: absolute;
            left: 0;
            top: 0;
            bottom: 0;
            width: 300px;
            background: rgba(10, 10, 20, 0.95);
            border-right: 1px solid var(--glass-border);
            z-index: 20;
            display: flex;
            flex-direction: column;
            backdrop-filter: blur(20px);
        }

        .sidebar-header {
            padding: 20px;
            border-bottom: 1px solid var(--glass-border);
        }

        .brand-small {
            font-size: 1.2rem;
            font-weight: 700;
            margin-bottom: 15px;
            color: var(--accent);
        }

        .tabs {
            display: flex;
            gap: 10px;
        }

        .tab-btn {
            background: transparent;
            border: 1px solid var(--glass-border);
            padding: 6px 12px;
            font-size: 0.8rem;
            color: var(--text-secondary);
        }

        .tab-btn.active {
            background: var(--accent);
            color: #000;
            border-color: var(--accent);
        }

        .tab-content {
            display: none;
            flex: 1;
            overflow-y: auto;
            padding: 10px;
        }
        .tab-content.active { display: block; }

        .file-tree {
            font-family: monospace;
            font-size: 0.9rem;
            color: var(--text-secondary);
        }
        
        .file-item {
            padding: 4px 8px;
            cursor: pointer;
            border-radius: 4px;
        }
        .file-item:hover { background: rgba(255,255,255,0.05); color: #fff; }
        .file-item.dir { font-weight: bold; color: #fff; }

        .markdown-view {
            font-size: 0.85rem;
            line-height: 1.5;
            color: #ccc;
            white-space: pre-wrap;
        }

        .small-btn {
            padding: 4px 8px;
            font-size: 0.75rem;
            width: auto;
            display: inline-block;
            margin-right: 5px;
        }

        /* Adjust UI Layer to not overlap sidebar */
        .ui-layer {
            padding-left: 324px; /* Sidebar + padding */
        }

        .status {

            position: absolute;
            bottom: 24px;
            left: 24px;
            font-size: 0.9rem;
            color: var(--text-secondary);
            pointer-events: auto;
        }

    </style>
    <!-- Import Map for Three.js -->
    <script type="importmap">
        {
            "imports": {
                "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
                "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
            }
        }
    </script>
</head>
<body>
    <div id="canvas-container"></div>
    
    <!-- Sidebar -->
    <div class="sidebar">
        <div class="sidebar-header">
            <div class="brand-small">Hello-AI</div>
            <div class="tabs">
                <button class="tab-btn active" data-tab="files">Files</button>
                <button class="tab-btn" data-tab="brain">Brain</button>
                <button class="tab-btn" data-tab="github">GitHub</button>
            </div>
        </div>
        
        <div id="tab-files" class="tab-content active">
            <div class="file-actions">
                <button class="small-btn" id="new-file-btn">+ File</button>
                <button class="small-btn" id="refresh-fs-btn">Start</button>
            </div>
            <div id="file-tree" class="file-tree">
                <!-- Javascript populates this -->
                <div style="padding: 20px; text-align: center; color: #666;">LOADING...</div>
            </div>
        </div>

        <div id="tab-brain" class="tab-content">
            <div class="brain-section">
                <h3>Current Task</h3>
                <div id="task-list" class="markdown-view">Loading...</div>
            </div>
             <div class="brain-section">
                <h3>Walkthrough</h3>
                <div id="walkthrough-view" class="markdown-view">Loading...</div>
            </div>
        </div>

        <div id="tab-github" class="tab-content">
            <div class="file-actions">
                <button class="small-btn" id="gh-connect-btn">Connect GitHub</button>
                <div id="gh-status" style="font-size: 0.8rem; display: inline-block; margin-left: 10px;">Not connected</div>
            </div>
            <div id="repo-list" class="file-tree" style="margin-top: 20px;">
                <!-- Repos go here -->
            </div>
        </div>
    </div>

    <!-- Main UI Layer (Floating Controls) -->
    <div class="ui-layer">
        <div class="header">
            <!-- Brand moved to sidebar -->
            <div style="flex: 1;"></div> 
        </div>

        <div class="controls">
            <!-- ... controls ... -->
            <div class="control-group">
                <label class="control-label">Selected Mesh</label>
                <div id="mesh-name" style="color: white; margin-bottom: 10px; font-size: 0.9rem;">None</div>
            </div>
            <!-- ... -->

            
            <div class="control-group">
                <label class="control-label">Color</label>
                <input type="color" id="color-input" class="color-picker" value="#ffffff">
            </div>

            <div class="control-group">
                <label class="control-label">AI Features</label>
                <input type="text" id="texture-prompt" placeholder="Texture prompt..." style="width: 100%; margin-bottom: 8px; padding: 8px; border-radius: 4px; border: none;">
                <button id="ai-texture-btn" style="margin-bottom: 8px;">Generate Texture</button>
                <button id="voice-btn">Hold to Speak</button>
            </div>

            <button id="save-btn" style="margin-top: 20px;">Save Asset</button>
        </div>
        
        <div class="status" id="status-text">Ready</div>
    </div>

    <!-- Main Editor Script -->
    <script type="module" src="/editor.js"></script>
</body>
</html>`;
}
