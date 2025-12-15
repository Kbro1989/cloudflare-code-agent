import { ProjectMemory } from './types';

interface Env {
    MEMORY: KVNamespace;
    CACHE: KVNamespace;
}

export class MemoryManager {
    constructor(private env: Env) {}

    async getProjectMemory(projectId: string): Promise<ProjectMemory | null> {
        const stored = await this.env.MEMORY.get(`project:${projectId}`, { type: 'json' });
        return stored as ProjectMemory | null;
    }

    async saveProjectMemory(project: ProjectMemory): Promise<void> {
        await this.env.MEMORY.put(`project:${project.id}`, JSON.stringify(project), { expirationTtl: 86400 }); // 24h TTL
    }

    async getCachedCompletion(promptHash: string): Promise<string | null> {
        return this.env.CACHE.get(`completion:${promptHash}`);
    }

    async cacheCompletion(promptHash: string, completion: string): Promise<void> {
        await this.env.CACHE.put(`completion:${promptHash}`, completion, { expirationTtl: 3600 }); // 1h TTL
    }
}
