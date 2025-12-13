import { R2Bucket, R2ObjectBody } from "@cloudflare/workers-types";

// File System Item Interface
export interface FSItem {
    name: string;
    path: string;
    type: 'file' | 'dir';
    children?: FSItem[];
}

export class VirtualFileSystem {
    constructor(private bucket: any) { } // temporary 'any' to avoid type conflict

    async list(prefix: string = ""): Promise<FSItem[]> {
        // R2 list is flat. We need to construct a tree or just list all keys and let UI handle tree.
        // For simplicity v1: Return flat list of files with their full paths.
        // UI scripts can build the tree.

        const list = await this.bucket.list({ prefix });
        const items: FSItem[] = list.objects.map((obj: any) => ({
            name: obj.key.split('/').pop() || obj.key,
            path: obj.key,
            type: obj.key.endsWith('/') ? 'dir' : 'file'
        }));

        return items;
    }

    async readFile(path: string): Promise<string | null> {
        const obj: R2ObjectBody = await this.bucket.get(path);
        if (!obj) return null;
        return await obj.text();
    }

    async createFile(path: string, content: string): Promise<void> {
        await this.bucket.put(path, content, {
            httpMetadata: { contentType: this.getContentType(path) }
        });
    }

    async createFolder(path: string): Promise<void> {
        if (!path.endsWith('/')) path += '/';
        await this.bucket.put(path, '', {
            customMetadata: { type: 'directory' }
        });
    }

    private getContentType(path: string): string {
        if (path.endsWith('.html')) return 'text/html';
        if (path.endsWith('.js') || path.endsWith('.ts')) return 'text/javascript';
        if (path.endsWith('.css')) return 'text/css';
        if (path.endsWith('.json')) return 'application/json';
        if (path.endsWith('.md')) return 'text/markdown';
        return 'text/plain';
    }
}
