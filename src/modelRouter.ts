/**
 * Model Router - Intelligent Task-Based Model Selection
 *
 * Automatically routes user requests to the optimal AI model based on:
 * 1. Explicit commands (/image, /voice, /think)
 * 2. File context (active file extension)
 * 3. Message content patterns
 */

// Model keys matching the MODELS registry in index.ts
export type ModelKey =
  | 'GPT_OSS' | 'LLAMA4_SCOUT' | 'REASONING' | 'QWQ_32B'
  | 'DEFAULT' | 'CODING' | 'DEEPSEEK_CODER' | 'MISTRAL_SMALL' | 'GEMMA_3' | 'QWEN3_30B'
  | 'KIMI' | 'GPT4O' | 'CLAUDE3'
  | 'FLUX_DEV' | 'FLUX' | 'SDXL' | 'DREAMSHAPER' | 'LUCID' | 'PHOENIX'
  | 'STT' | 'FLUX_STT' | 'TTS' | 'AURA' | 'AURA_ES'
  | 'LLAVA' | 'RESNET';

export type TaskType =
  | 'code_generate' | 'code_review' | 'code_fix' | 'code_explain'
  | 'reasoning' | 'math' | 'architecture'
  | 'image_generate' | 'image_quick'
  | 'audio_speak' | 'audio_transcribe'
  | 'vision_analyze'
  | 'chat_quick' | 'chat_detailed';

export type EndpointType = '/api/chat' | '/api/image' | '/api/audio/generate' | '/api/audio/stt' | '/api/audio/tts';

export interface TaskClassification {
  task: TaskType;
  confidence: number; // 0-1
  suggestedModel: ModelKey;
  endpoint: EndpointType;
  reasoning: string; // Human-readable explanation
}

// Pattern definitions for task detection
const TASK_PATTERNS: Array<{
  task: TaskType;
  patterns: RegExp[];
  model: ModelKey;
  endpoint: EndpointType;
  priority: number;
}> = [
    // === EXPLICIT COMMANDS (Highest Priority) ===
    {
      task: 'image_generate',
      patterns: [/^\/image\s+/i, /\[IMAGE:\s*/i, /^generate\s+image/i, /^draw\s+/i, /^create\s+art/i, /^paint\s+/i],
      model: 'FLUX_DEV',
      endpoint: '/api/image',
      priority: 100
    },
    {
      task: 'image_quick',
      patterns: [/quick\s+sketch/i, /thumbnail/i, /preview\s+image/i, /fast\s+image/i],
      model: 'FLUX',
      endpoint: '/api/image',
      priority: 99
    },
    {
      task: 'audio_speak',
      patterns: [/^\/speak\s+/i, /^\/voice\s+/i, /^say\s+out\s+loud/i, /^read\s+aloud/i, /\[TTS:\s*/i],
      model: 'AURA',
      endpoint: '/api/audio/tts',
      priority: 98
    },
    {
      task: 'reasoning',
      patterns: [/^\/think\s+/i, /^\/reason\s+/i, /think\s+through/i, /step\s+by\s+step/i, /chain\s+of\s+thought/i],
      model: 'QWQ_32B',
      endpoint: '/api/chat',
      priority: 97
    },

    // === CODE OPERATIONS ===
    {
      task: 'code_generate',
      patterns: [/^write\s+(a\s+)?code/i, /^implement\s+/i, /^create\s+function/i, /^add\s+method/i, /^generate\s+class/i, /build\s+a\s+/i],
      model: 'CODING',
      endpoint: '/api/chat',
      priority: 80
    },
    {
      task: 'code_review',
      patterns: [/review\s+(this\s+)?code/i, /code\s+review/i, /security\s+audit/i, /check\s+for\s+bugs/i, /analyze\s+this\s+code/i],
      model: 'REASONING',
      endpoint: '/api/chat',
      priority: 79
    },
    {
      task: 'code_fix',
      patterns: [/fix\s+(this\s+)?bug/i, /debug\s+/i, /^fix\s+/i, /error\s+in/i, /broken/i, /not\s+working/i, /doesn't\s+work/i],
      model: 'CODING',
      endpoint: '/api/chat',
      priority: 78
    },
    {
      task: 'code_explain',
      patterns: [/explain\s+(this\s+)?code/i, /what\s+does\s+this/i, /how\s+does\s+this\s+work/i, /walk\s+me\s+through/i],
      model: 'DEFAULT',
      endpoint: '/api/chat',
      priority: 77
    },

    // === REASONING & ANALYSIS ===
    {
      task: 'architecture',
      patterns: [/design\s+system/i, /architecture/i, /system\s+design/i, /high\s+level\s+design/i, /microservice/i],
      model: 'REASONING',
      endpoint: '/api/chat',
      priority: 70
    },
    {
      task: 'math',
      patterns: [/calculate/i, /solve\s+/i, /equation/i, /\d+\s*[\+\-\*\/]\s*\d+/, /derivative/i, /integral/i, /proof/i],
      model: 'QWQ_32B',
      endpoint: '/api/chat',
      priority: 69
    },

    // === VISION ===
    {
      task: 'vision_analyze',
      patterns: [/analyze\s+this\s+image/i, /what's\s+in\s+this\s+image/i, /describe\s+the\s+image/i, /look\s+at\s+this/i],
      model: 'LLAVA',
      endpoint: '/api/chat',
      priority: 60
    },

    // === GENERAL CHAT ===
    {
      task: 'chat_detailed',
      patterns: [/detailed/i, /comprehensive/i, /in\s+depth/i, /thoroughly/i, /elaborate/i],
      model: 'LLAMA4_SCOUT',
      endpoint: '/api/chat',
      priority: 50
    },
    {
      task: 'chat_quick',
      patterns: [/^hi$/i, /^hello$/i, /^hey$/i, /^thanks$/i, /^ok$/i, /^yes$/i, /^no$/i],
      model: 'DEFAULT',
      endpoint: '/api/chat',
      priority: 10
    }
  ];

// File extension to model mapping for context-aware routing
const FILE_CONTEXT_MODELS: Record<string, ModelKey> = {
  // Code files → Coding model
  '.ts': 'CODING',
  '.tsx': 'CODING',
  '.js': 'CODING',
  '.jsx': 'CODING',
  '.py': 'CODING',
  '.rs': 'CODING',
  '.go': 'CODING',
  '.java': 'CODING',
  '.c': 'CODING',
  '.cpp': 'CODING',
  '.cs': 'CODING',
  '.rb': 'CODING',
  '.php': 'CODING',
  '.swift': 'CODING',
  '.kt': 'CODING',

  // Config/Data → Fast general model
  '.json': 'DEFAULT',
  '.yaml': 'DEFAULT',
  '.yml': 'DEFAULT',
  '.toml': 'DEFAULT',
  '.xml': 'DEFAULT',

  // Markdown/Docs → Reasoning for better analysis
  '.md': 'DEFAULT',
  '.txt': 'DEFAULT',

  // Shaders/Graphics → Specialized
  '.glsl': 'CODING',
  '.hlsl': 'CODING',
  '.wgsl': 'CODING',
};

/**
 * Classify a user message and determine the optimal model
 */
export function classifyTask(message: string, activeFile?: string, hasImageAttachment?: boolean): TaskClassification {
  const normalizedMessage = message.trim().toLowerCase();

  // 1. Check for image attachment → Vision model
  if (hasImageAttachment) {
    return {
      task: 'vision_analyze',
      confidence: 0.95,
      suggestedModel: 'LLAVA',
      endpoint: '/api/chat',
      reasoning: 'Image attachment detected - using vision model'
    };
  }

  // 2. Pattern matching (sorted by priority)
  const sortedPatterns = [...TASK_PATTERNS].sort((a, b) => b.priority - a.priority);

  for (const pattern of sortedPatterns) {
    for (const regex of pattern.patterns) {
      if (regex.test(message)) {
        return {
          task: pattern.task,
          confidence: 0.9,
          suggestedModel: pattern.model,
          endpoint: pattern.endpoint,
          reasoning: `Pattern matched: "${regex.source}" → ${pattern.task}`
        };
      }
    }
  }

  // 3. File context fallback (if editing a code file, lean towards coding model)
  if (activeFile) {
    const ext = activeFile.substring(activeFile.lastIndexOf('.')).toLowerCase();
    const contextModel = FILE_CONTEXT_MODELS[ext];
    if (contextModel) {
      // Check if message seems code-related
      const codeIndicators = /function|class|const|let|var|import|export|return|if|for|while|async|await|=>|\{|\}/i;
      if (codeIndicators.test(message)) {
        return {
          task: 'code_generate',
          confidence: 0.7,
          suggestedModel: contextModel,
          endpoint: '/api/chat',
          reasoning: `File context (${ext}) + code indicators detected`
        };
      }
    }
  }

  // 4. Default fallback
  return {
    task: 'chat_quick',
    confidence: 0.5,
    suggestedModel: 'DEFAULT',
    endpoint: '/api/chat',
    reasoning: 'No specific pattern matched - using fast default model'
  };
}

/**
 * Get a human-friendly name for displaying the selected model
 */
export function getModelDisplayName(modelKey: ModelKey): string {
  const names: Record<ModelKey, string> = {
    'GPT_OSS': 'GPT-OSS 120B',
    'LLAMA4_SCOUT': 'Llama 4 Scout',
    'REASONING': 'DeepSeek R1',
    'QWQ_32B': 'QwQ (Thinking)',
    'DEFAULT': 'Llama 3.3',
    'CODING': 'Qwen Coder',
    'DEEPSEEK_CODER': 'DeepSeek Coder',
    'MISTRAL_SMALL': 'Mistral Small',
    'GEMMA_3': 'Gemma 3',
    'QWEN3_30B': 'Qwen3 30B',
    'KIMI': 'Kimi K1.5',
    'GPT4O': 'GPT-4o',
    'CLAUDE3': 'Claude 3.5',
    'FLUX_DEV': 'Flux Dev',
    'FLUX': 'Flux Schnell',
    'SDXL': 'SDXL Lightning',
    'DREAMSHAPER': 'DreamShaper',
    'LUCID': 'Lucid Origin',
    'PHOENIX': 'Phoenix',
    'STT': 'Whisper',
    'FLUX_STT': 'Deepgram STT',
    'TTS': 'MeloTTS',
    'AURA': 'Aura 2',
    'AURA_ES': 'Aura 2 (ES)',
    'LLAVA': 'LLaVA Vision',
    'RESNET': 'ResNet-50'
  };
  return names[modelKey] || modelKey;
}

/**
 * Get task icon for UI display
 */
export function getTaskIcon(task: TaskType): string {
  const icons: Record<TaskType, string> = {
    'code_generate': '💻',
    'code_review': '🔍',
    'code_fix': '🔧',
    'code_explain': '📖',
    'reasoning': '🧠',
    'math': '🔢',
    'architecture': '🏗️',
    'image_generate': '🎨',
    'image_quick': '⚡',
    'audio_speak': '🔊',
    'audio_transcribe': '🎙️',
    'vision_analyze': '👁️',
    'chat_quick': '💬',
    'chat_detailed': '📝'
  };
  return icons[task] || '🤖';
}
