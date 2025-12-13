export { Session } from "./server/session";

import worker from "./server/worker";

export interface Env {
    MY_KV: KVNamespace;
    AI: any;
    SESSION_DO: DurableObjectNamespace;
    WORKSPACE_BUCKET: R2Bucket;
}

export default worker;
