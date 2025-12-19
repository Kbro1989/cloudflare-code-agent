export class GitHubService {
    private static API_URL = "https://api.github.com";

    constructor(private clientId: string, private clientSecret: string) { }

    /**
     * Exchange the temporary code for an access token.
     */
    async getAccessToken(code: string): Promise<string | null> {
        try {
            const response = await fetch("https://github.com/login/oauth/access_token", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "User-Agent": "Hello-AI-Agent"
                },
                body: JSON.stringify({
                    client_id: this.clientId,
                    client_secret: this.clientSecret,
                    code,
                }),
            });

            if (!response.ok) {
                const text = await response.text();
                console.error("GitHub Token Error:", text);
                return null;
            }

            const data: any = await response.json();
            return data.access_token || null;
        } catch (error) {
            console.error(error);
            return null;
        }
    }

    /**
     * Fetch authenticated user details.
     */
    async getUser(token: string) {
        return this.request(token, "/user");
    }

    /**
     * List user repositories.
     */
    async listRepos(token: string) {
        return this.request(token, "/user/repos?sort=updated&per_page=20");
    }

    /**
     * Get file or directory content.
     */
    async getRepoContent(token: string, owner: string, repo: string, path: string = "") {
        return this.request(token, `/repos/${owner}/${repo}/contents/${path}`);
    }

    async getTree(token: string, owner: string, repo: string, branch: string = "main") {
        // recursive=1 to get full tree
        return this.request(token, `/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
    }

    /**
     * Git Data API: Create a blob (file content)
     */
    async createBlob(token: string, owner: string, repo: string, content: string, encoding: string = "utf-8") {
        return this.request(token, `/repos/${owner}/${repo}/git/blobs`, "POST", {
            content,
            encoding
        });
    }

    /**
     * Git Data API: Create a new tree
     */
    async createTree(token: string, owner: string, repo: string, baseTreeSha: string, tree: any[]) {
        return this.request(token, `/repos/${owner}/${repo}/git/trees`, "POST", {
            base_tree: baseTreeSha,
            tree
        });
    }

    /**
     * Git Data API: Create a commit
     */
    async createCommit(token: string, owner: string, repo: string, message: string, treeSha: string, parentShas: string[]) {
        return this.request(token, `/repos/${owner}/${repo}/git/commits`, "POST", {
            message,
            tree: treeSha,
            parents: parentShas
        });
    }

    /**
     * Git Data API: Update a reference (push)
     */
    async updateRef(token: string, owner: string, repo: string, ref: string, sha: string) {
        return this.request(token, `/repos/${owner}/${repo}/git/refs/${ref}`, "PATCH", {
            sha,
            force: false
        });
    }

    private async request(token: string, endpoint: string, method: string = "GET", body?: any) {
        const options: RequestInit = {
            method,
            headers: {
                "Authorization": `Bearer ${token}`,
                "Accept": "application/vnd.github.v3+json",
                "User-Agent": "Hello-AI-Agent"
            }
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(`${GitHubService.API_URL}${endpoint}`, options);

        if (!response.ok) {
            throw new Error(`GitHub API Error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    }
}
