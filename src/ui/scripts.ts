export const editorScript = `import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// State
let scene, camera, renderer, controls;
let raycaster, pointer;
let selectedObject = null;

// UI Elements
const colorInput = document.getElementById('color-input');
const meshNameDisplay = document.getElementById('mesh-name');
const statusText = document.getElementById('status-text');
const saveBtn = document.getElementById('save-btn');

function init() {
    // 1. Scene Setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#1a1a2e'); // Fallback if transparent
    scene.fog = new THREE.FogExp2(0x1a1a2e, 0.02);

    // 2. Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;
    camera.position.y = 2;

    // 3. Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // Alpha for CSS gradient bg
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    // 4. Lights
    const ambientLight = new THREE.AmbientLight(0x404040, 2);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.position.set(5, 10, 7.5);
    scene.add(dirLight);

    // 5. Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // 6. Default Content (Placeholder for R2 models)
    createPlaceholderModel();

    // 7. Interaction
    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('click', onPointerClick);
    
    // UI Listeners
    colorInput.addEventListener('input', onColorChange);
    saveBtn.addEventListener('click', onSave);
    document.getElementById('ai-texture-btn').addEventListener('click', onGenerateTexture);
    
    const voiceBtn = document.getElementById('voice-btn');
    voiceBtn.addEventListener('mousedown', startRecording);
    voiceBtn.addEventListener('mouseup', stopRecording);
    voiceBtn.addEventListener('mouseleave', stopRecording); // Handle drag out

    // Tab Handling
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(btn => {
        btn.addEventListener('click', () => {
             // Remove active class
             document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
             document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
             
             // Add active
             btn.classList.add('active');
             const tabName = btn.getAttribute('data-tab');
             document.getElementById('tab-' + tabName).classList.add('active');
             
             if (tabName === 'files') refreshFileTree();
             if (tabName === 'brain') refreshBrain();
        });
    });

    document.getElementById('refresh-fs-btn').addEventListener('click', refreshFileTree);
    document.getElementById('new-file-btn').addEventListener('click', () => {
         const path = prompt("Enter file path (e.g., src/component.ts):");
         if (path) createFile(path, "");
    });

    // Initial Load
    refreshFileTree();

    // Start Loop
    animate();
}

// File System Functions
async function refreshFileTree() {
    const treeEl = document.getElementById('file-tree');
    treeEl.innerHTML = "Loading...";
    
    try {
        const res = await fetch('/fs/list');
        const items = await res.json();
        
        treeEl.innerHTML = '';
        renderTree(items, treeEl);
    } catch (e) {
        treeEl.innerHTML = "Error loading files";
        console.error(e);
    }
}

function renderTree(items, container) {
    if (items.length === 0) {
        container.innerHTML = "<div style='padding:10px'>No files yet.</div>";
        return;
    }
    
    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'file-item ' + item.type;
        div.textContent = (item.type === 'dir' ? '📁 ' : '📄 ') + item.name;
        div.onclick = () => {
            if (item.type === 'file') openFile(item.path);
        };
        container.appendChild(div);
    });
}

async function createFile(path, content) {
    try {
        await fetch('/fs/create', {
             method: 'POST',
             headers: {'Content-Type': 'application/json'},
             body: JSON.stringify({ path, content, type: 'file' })
        });
        refreshFileTree();
    } catch (e) {
        alert("Failed to create file");
    }
}

async function openFile(path) {
    // Basic View - In a real app this would open an editor tab
    const res = await fetch('/fs/read?path=' + encodeURIComponent(path));
    const text = await res.text();
    alert("Content of " + path + ":\n\n" + text.slice(0, 500) + "...");
}

async function refreshBrain() {
    // ... existing ...
}

// GitHub Functions
let githubToken = localStorage.getItem('hello_ai_gh_token');

function initGitHub() {
    const connectBtn = document.getElementById('gh-connect-btn');
    const statusEl = document.getElementById('gh-status');
    
    if (githubToken) {
        statusEl.textContent = "Connected";
        connectBtn.textContent = "Refresh Repos";
        loadRepos();
    }
    
    connectBtn.addEventListener('click', () => {
        if (!githubToken) {
            // Open Popup
            const width = 600, height = 700;
            const left = (window.innerWidth - width) / 2;
            const top = (window.innerHeight - height) / 2;
            
            window.open('/auth/github/login', 'github_auth', 
                'width=' + width + ',height=' + height + ',top=' + top + ',left=' + left);
                
            statusEl.textContent = "Connecting...";
        } else {
            loadRepos();
        }
    });
    
    // Listen for token
    window.addEventListener('message', (event) => {
        if (event.data.type === 'GITHUB_TOKEN') {
            githubToken = event.data.token;
            localStorage.setItem('hello_ai_gh_token', githubToken);
            statusEl.textContent = "Connected!";
            connectBtn.textContent = "Refresh Repos";
            loadRepos();
        }
    });
}

async function loadRepos() {
    const listEl = document.getElementById('repo-list');
    listEl.innerHTML = "Loading repos...";
    
    try {
        const res = await fetch('/github/repos', {
            headers: { 'Authorization': 'Bearer ' + githubToken }
        });
        
        if (!res.ok) throw new Error("Failed to fetch repos");
        
        const repos = await res.json();
        listEl.innerHTML = '';
        
        repos.forEach(repo => {
            const div = document.createElement('div');
            div.className = 'file-item';
            div.textContent = '📦 ' + repo.name; // (${repo.stargazers_count}⭐)
            div.title = repo.description || "No description";
            div.onclick = () => {
                // Future: Clone logic
                alert("Clone " + repo.name + " feature coming soon!");
            };
            listEl.appendChild(div);
        });
        
    } catch (e) {
        console.error(e);
        listEl.innerHTML = "Error loading repos. Token might be invalid.";
        localStorage.removeItem('hello_ai_gh_token');
    }
}

// Call init after page load
setTimeout(initGitHub, 100);

// ... (Rest of Existing Functions) ...

async function onGenerateTexture() {
    if (!selectedObject) {
         statusText.textContent = "Select a mesh first!";
         return;
    }
    
    const prompt = document.getElementById('texture-prompt').value;
    if (!prompt) return;

    statusText.textContent = "Generating Texture...";
    
    try {
        const res = await fetch('/ai/texture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });
        
        if (!res.ok) throw new Error("Texture gen failed");
        
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        
        const loader = new THREE.TextureLoader();
        loader.load(url, (texture) => {
            selectedObject.material.map = texture;
            selectedObject.material.needsUpdate = true;
            selectedObject.material.color.setHex(0xffffff); // Reset color to white to show texture
            statusText.textContent = "Texture Applied!";
        });
    } catch (e) {
        console.error(e);
        statusText.textContent = "AI Error.";
    }
}

let mediaRecorder;
let audioChunks = [];

async function startRecording() {
    statusText.textContent = "Listening...";
    audioChunks = [];
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        
        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' }); // Whisper supports webm
            await processVoiceCommand(audioBlob);
        };
        
        mediaRecorder.start();
    } catch (err) {
        console.error("Mic Error:", err);
        statusText.textContent = "Mic Error";
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        statusText.textContent = "Processing...";
    }
}

async function processVoiceCommand(audioBlob) {
    try {
        const res = await fetch('/ai/transcribe', {
            method: 'POST',
            body: audioBlob
        });
        
        if (!res.ok) throw new Error("Transcribe failed");
        
        const data = await res.json();
        const text = data.text.toLowerCase();
        statusText.textContent = \`Heard: "\${text}"\`;
        
        // Simple Command Parser
        if (selectedObject) {
            if (text.includes("red")) selectedObject.material.color.setHex(0xff0000);
            else if (text.includes("blue")) selectedObject.material.color.setHex(0x0000ff);
            else if (text.includes("green")) selectedObject.material.color.setHex(0x00ff00);
            else if (text.includes("reset")) selectedObject.material.color.setHex(0xffffff);
        }
    } catch (e) {
        console.error(e);
        statusText.textContent = "Voice Failed";
    }
}


function createPlaceholderModel() {
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const material = new THREE.MeshStandardMaterial({ 
        color: 0x00f2ea,
        roughness: 0.2,
        metalness: 0.8
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "Crystal_Shard";
    scene.add(mesh);

    // Add a grid
    const gridHelper = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
    scene.add(gridHelper);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function onPointerClick(event) {
    if (event.target.closest('.controls')) return; // Ignore clicks on UI

    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(scene.children);

    if (intersects.length > 0) {
        const target = intersects[0].object;
        // Basic filter for helpers
        if (target.type === 'Mesh') {
            selectObject(target);
        }
    } else {
        deselectObject();
    }
}

function selectObject(mesh) {
    selectedObject = mesh;
    meshNameDisplay.textContent = mesh.name || "Unnamed Mesh";
    
    // Update color picker to match mesh
    const color = mesh.material.color.getHexString();
    colorInput.value = '#' + color;
    
    statusText.textContent = \`Selected: \${mesh.name}\`;
}

function deselectObject() {
    selectedObject = null;
    meshNameDisplay.textContent = "None";
    statusText.textContent = "Ready";
}

function onColorChange(e) {
    if (selectedObject) {
        selectedObject.material.color.set(e.target.value);
    }
}

async function onSave() {
    if (!selectedObject) {
        statusText.textContent = "Nothing to save!";
        return;
    }

    statusText.textContent = "Saving...";
    
    // Serialize (simple metadata for now, can expand to GLTF export)
    const data = {
        name: selectedObject.name,
        color: selectedObject.material.color.getHexString(),
        timestamp: Date.now()
    };

    try {
        const res = await fetch('/assets/' + selectedObject.name, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (res.ok) {
            statusText.textContent = "Saved to R2!";
            setTimeout(() => statusText.textContent = "Ready", 2000);
        } else {
            statusText.textContent = "Save failed.";
        }
    } catch (err) {
        console.error(err);
        statusText.textContent = "Error saving.";
    }
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    
    // Subtle rotation for "alive" feel
    if (selectedObject) {
        selectedObject.rotation.y += 0.005;
    }

    renderer.render(scene, camera);
}

init();`;
