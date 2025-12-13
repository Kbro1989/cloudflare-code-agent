export class StorageService {
    constructor(private bucket: any) { }

    async upload(key: string, data: any, contentType: string = 'application/octet-stream'): Promise<R2Object> {
        return await this.bucket.put(key, data, {
            httpMetadata: { contentType }
        });
    }

    async get(key: string): Promise<R2ObjectBody | null> {
        return await this.bucket.get(key);
    }

    async list(): Promise<R2Objects> {
        return await this.bucket.list();
    }
}
