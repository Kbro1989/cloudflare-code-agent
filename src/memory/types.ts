export interface ProjectMemory {
    id: string;
    name: string;
    type: string;
    bootstrapped: boolean;
    patterns: Record<string, Pattern>;
    conventions: {
        naming: string[];
        structure: string[];
        imports: string[];
        errorHandling: string[];
        patterns: string[];
    };
    entities: Record<string, any>;
    relationships: Record<string, any>;
    learnings: any[];
    stats: {
        completions: number;
        cacheHits: number;
        tokensUsed: number;
        avgDuration: number;
        lastCompletion: number;
    };
    meta: {
        created: number;
        lastUpdated: number;
        lastSession: number;
    };
}

export interface SessionMemory {
    projectId: string;
    sessionId: string;
    activeFiles: any[];
    recentEdits: {
        fileId: string;
        filePath: string;
        timestamp: number;
        summary: string;
        changedLines: number;
    }[];
    workingMemory: any[];
    tempPatterns: Record<string, any>;
    meta: {
        started: number;
        lastActivity: number;
        completions: number;
    };
    currentFile?: string;
    currentTask?: string;
}

export interface AICompleteArgs {
    projectId: string;
    sessionId: string;
    fileId: string;
    code: string;
    cursor: number;
    language: string;
}

export interface FileSaveArgs {
    projectId: string;
    sessionId: string;
    fileId: string;
    filePath: string;
    code: string;
}

export interface Pattern {
    id: string;
    name: string;
    template: string;
    type: string;
    usageCount: number;
    confidence: number;
    examples: any[];
    firstSeen: number;
    lastUsed: number;
}

export interface ModelConfig {
    name: string;
    tier: string;
    maxTokens: number;
    temperature: number;
}
