import { Ai } from "@cloudflare/workers-types";
import { validateFull } from "./validate.ts";

interface ExecuteParams {
    ai: Ai;
    model: string;
    input: string;
    files: Record<string, string>;
    intent: string;
    history: any[];
    sessionId: string;
}

export interface ExecuteResult {
    intent: string;
    artifact?: string; // For diffs
    response?: string; // For text (explain/review)
    error?: { type: string; message: string; details?: string };
}

export async function executeTask(params: ExecuteParams): Promise<ExecuteResult> {
    const { ai, model, input, files, intent, history, sessionId } = params;

    // Decide mode: Coding (Diff) vs Chat (Text)
    const isCodingTask = ["implement", "debug", "optimize"].includes(intent);

    // Construct System Prompt
    const systemMessages = [
        { role: "system", content: "You are an expert AI software engineer." },
        { role: "system", content: `Current Intent: ${intent}` }
    ];

    // Add File Context
    // Truncate large files if necessary (basic protection)
    let fileContext = "Project Files:\n";
    for (const [name, content] of Object.entries(files)) {
        fileContext += `\n--- ${name} ---\n${content}\n`;
    }
    systemMessages.push({ role: "system", content: fileContext });

    if (isCodingTask) {
        systemMessages.push(
            { role: "system", content: "You must output a unified diff to apply changes." },
            { role: "system", content: "Format: `diff --git a/path/to/file b/path/to/file`" },
            { role: "system", content: "Do not include markdown code blocks around the diff." }
        );
    } else {
        systemMessages.push(
            { role: "system", content: "Provide a detailed markdown response." },
            { role: "system", content: "Use code blocks for examples." }
        );
    }

    // Combine History + New Input
    const messages = [
        ...systemMessages,
        ...history,
        { role: "user", content: input }
    ];

    // Attempt 1
    /* console.log("Calling model with messages:", JSON.stringify(messages).slice(0, 500)); */
    let response = await callModel(ai, model, messages);

    // If chat task, return text immediately
    if (!isCodingTask) {
        return { intent, response };
    }

    // If coding task, validate diff
    const allowedFiles = new Set(Object.keys(files));
    let validation = validateFull(response, allowedFiles, files);

    if (validation.valid) {
        return { intent, artifact: response };
    }

    // Attempt 2: Corrective Feedback
    console.warn("Validation failed, retrying", { intent, error: validation.error });
    messages.push(
        { role: "assistant", content: response },
        { role: "system", content: `CRITICAL ERROR: ${validation.error}. ${validation.details || ""}\nFix the diff format immediately.` }
    );

    response = await callModel(ai, model, messages);
    validation = validateFull(response, allowedFiles, files);

    if (validation.valid) {
        return { intent, artifact: response };
    }

    // Fallback: If still invalid, return as text error (or raw response if useful)
    return {
        intent,
        error: {
            type: validation.stage,
            message: "Failed to generate valid patch",
            details: response // Return the raw output so user can see it in dashboard
        }
    };
}

async function callModel(ai: Ai, model: string, messages: any[]): Promise<string> {
    const response = await ai.run(model, { messages });
    return typeof response === "string" ? response : response.response || "";
}
