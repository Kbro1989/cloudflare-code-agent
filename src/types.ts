import { KVNamespace, R2Bucket } from "@cloudflare/workers-types";

export interface Env {
    MY_KV: KVNamespace;
    AI: any;
    ASSETS: R2Bucket;
    GITHUB_CLIENT_ID: string;
    GITHUB_CLIENT_SECRET: string;
}
