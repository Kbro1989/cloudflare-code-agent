import { VirtualFileSystem } from "../services/vfs";

export class ArtifactManager {
    constructor(private vfs: VirtualFileSystem) { }

    async updateTask(taskName: string, status: string): Promise<void> {
        const path = "brain/task.md";
        let content = await this.vfs.readFile(path) || "# Tasks\n\n";

        // Simple append logic for v1. Ideally parse markdown.
        const date = new Date().toISOString();
        content += `- [ ] **${taskName}**: ${status} (${date})\n`;

        await this.vfs.createFile(path, content);
    }

    async createWalkthrough(title: string, summary: string): Promise<void> {
        const path = "brain/walkthrough.md";
        let content = await this.vfs.readFile(path) || "# Walkthrough\n\n";

        content += `## ${title}\n${summary}\n\n`;
        await this.vfs.createFile(path, content);
    }

    async addTodo(todo: string): Promise<void> {
        const path = "brain/todo.md";
        let content = await this.vfs.readFile(path) || "# TODOs\n\n";

        content += `- [ ] ${todo}\n`;
        await this.vfs.createFile(path, content);
    }

    async scanForTodos(filePath: string): Promise<void> {
        const fileContent = await this.vfs.readFile(filePath);
        if (!fileContent) return;

        const lines = fileContent.split('\n');
        for (const line of lines) {
            if (line.includes('// TODO') || line.includes('<!-- TODO')) {
                const todo = line.replace(/.*TODO/, '').trim();
                await this.addTodo(`${todo} (found in ${filePath})`);
            }
        }
    }
}
