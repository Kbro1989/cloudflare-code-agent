import { Ai } from "@cloudflare/workers-types";
import { validateFull } from "./validate.ts";

interface ExecuteParams {
    ai: Ai;
    model: string;
    input: string;
    files: Record<string, string>;
    plan: string[];
    sessionId: string;
}

export interface ExecuteResult {
    intent: "implement";
    plan: string[];
    artifact?: string;
    error?: { type: string; message: string; details?: string };
}

export async function executeImplement(params: ExecuteParams): Promise<ExecuteResult> {
    const { ai, model, input, files, plan, sessionId } = params;
    const allowedFiles = new Set(Object.keys(files));

    // Attempt 1
    let modelOutput = await callModel(ai, model, input, plan, null);
    let validation = validateFull(modelOutput, allowedFiles, files);

    if (validation.valid) {
        return { intent: "implement", plan, artifact: modelOutput };
    }

    // Attempt 2: corrective feedback
    console.warn("Agent validation failed", {
        sessionId,
        stage: validation.stage,
        error: validation.error,
        model,
        retryCount: 1
    });

    const correctiveMessage = `${validation.stage}: ${validation.error}. ${validation.details ?? ""}`;
    modelOutput = await callModel(ai, model, input, plan, correctiveMessage);
    validation = validateFull(modelOutput, allowedFiles, files);

    if (validation.valid) {
        return { intent: "implement", plan, artifact: modelOutput };
    }

    // Hard failure
    return {
        intent: "implement",
        plan,
        error: {
            type: validation.stage,
            message: validation.details || validation.error,
            details: modelOutput
        }
    };
}

async function callModel(
    ai: Ai,
    model: string,
    input: string,
    plan: string[],
    correctiveContext: string | null
): Promise<string> {
    const messages: any[] = [
        { role: "system", content: "You are a senior software engineer." },
        { role: "system", content: `Execution plan:\n${plan.join("\n")}` },
        { role: "system", content: "Output format: unified diff" },
        { role: "system", content: "Rules: Only modify provided files. Use valid unified diff format." }
    ];

    if (correctiveContext) {
        messages.push(
            { role: "system", content: `CORRECTIVE FEEDBACK:\n${correctiveContext}` },
            { role: "system", content: "Do not explain. Do not apologize. Output ONLY the corrected diff." }
        );
    }

    messages.push({ role: "user", content: input });

    const response = await ai.run(model, { messages });
    return typeof response === "string" ? response : response.response || "";
}
