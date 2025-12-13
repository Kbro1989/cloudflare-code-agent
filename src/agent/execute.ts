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

export interface ValidationStep {
    name: string;
    status: "pending" | "running" | "success" | "failure";
    message?: string;
}

export interface ExecuteResult {
    intent: string;
    artifact?: string;
    response?: string;
    error?: { type: string; message: string; details?: string };
    steps?: ValidationStep[];
    metrics?: {
        durationMs: number;
        inputTokens?: number;
        outputTokens?: number;
    };
}

export async function executeTask(params: ExecuteParams): Promise<ExecuteResult> {
    const start = performance.now();
    const { ai, model, input, files, intent, history, sessionId } = params;

    const steps: ValidationStep[] = [
        { name: "Generation", status: "pending" },
        { name: "Structure", status: "pending" },
        { name: "Parse", status: "pending" },
        { name: "Context", status: "pending" }
    ];

    // Decide mode
    const isCodingTask = ["implement", "debug", "optimize"].includes(intent);

    // System Prompt
    const systemMessages = [
        { role: "system", content: "You are an expert AI software engineer." },
        { role: "system", content: `Current Intent: ${intent}` }
    ];

    let fileContext = "Project Files:\n";
    for (const [name, content] of Object.entries(files)) {
        fileContext += `\n--- ${name} ---\n${content}\n`;
    }
    systemMessages.push({ role: "system", content: fileContext });

    if (isCodingTask) {
        systemMessages.push(
            { role: "system", content: "You must output a unified diff to apply changes." },
            { role: "system", content: "Format: `diff --git a/path/to/file b/path/to/file`" },
            { role: "system", content: "Example - Modifying a file:\n```diff\ndiff --git a/main.ts b/main.ts\n--- a/main.ts\n+++ b/main.ts\n@@ -1,1 +1,1 @@\n-console.log('old');\n+console.log('new');\n```" },
            { role: "system", content: "Example - Creating a new file:\n```diff\ndiff --git a/new.ts b/new.ts\nnew file mode 100644\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,1 @@\n+console.log('new file');\n```" },
            { role: "system", content: "Do not include markdown code blocks around the diff." }
        );
    } else {
        systemMessages.push(
            { role: "system", content: "Provide a detailed markdown response." },
            { role: "system", content: "Use code blocks for examples." }
        );
    }

    const messages = [
        ...systemMessages,
        ...history,
        { role: "user", content: input }
    ];

    // --- Step 1: Generation ---
    updateStep(steps, "Generation", "running");

    let response = "";
    try {
        response = await callModel(ai, model, messages);
        updateStep(steps, "Generation", "success");
    } catch (e: any) {
        updateStep(steps, "Generation", "failure", e.message);
        return { intent, error: { type: "Generation", message: e.message }, steps, metrics: { durationMs: performance.now() - start } };
    }

    if (!isCodingTask) {
        // Skip complex validation for text tasks
        return { intent, response, steps, metrics: { durationMs: performance.now() - start } };
    }

    // --- Validation Pipeline ---
    const allowedFiles = new Set(Object.keys(files));

    // We manually simulate the stages for the UI since validateFull is monolithic currently
    // In a real optimized version, validateFull would return granular stages too.
    // For now, if validateFull passes, all pass. If it fails, we assume it failed at the specific stage mentioned in error.

    updateStep(steps, "Structure", "running");
    // Check basic diff structure
    if (!response.includes("diff --git")) {
        updateStep(steps, "Structure", "failure", "Missing diff header");

        // RETRY Logic for Structure
        console.warn("Validation failed (structure), retrying...");
        updateStep(steps, "Generation", "running", "Retrying structure fix...");
        messages.push(
            { role: "assistant", content: response },
            { role: "system", content: `CRITICAL ERROR: You failed to provide a valid 'diff --git' patch. You MUST provide a unified diff. Please try again.` }
        );
        try {
            response = await callModel(ai, model, messages);
            if (response.includes("diff --git")) {
                updateStep(steps, "Generation", "success", "Corrected");
                updateStep(steps, "Structure", "success");
                // Continue to Parse...
                // Note: We need to refactor control flow to flow into Parse.
                // For simplicity, we recursively call or just verify here.
                const vRe = validateFull(response, allowedFiles, files);
                if (vRe.valid) {
                    updateStep(steps, "Parse", "success");
                    updateStep(steps, "Context", "success");
                    return { intent, artifact: response, steps, metrics: { durationMs: performance.now() - start } };
                }
            } else {
                return { intent, error: { type: "Structure", message: "Failed to generate valid diff header after retry" }, steps, metrics: { durationMs: performance.now() - start } };
            }
        } catch (e) { /* ignore */ }
    } else {
        updateStep(steps, "Structure", "success");
        updateStep(steps, "Parse", "running");

        const validation = validateFull(response, allowedFiles, files);

        if (validation.valid) {
            updateStep(steps, "Parse", "success");
            updateStep(steps, "Context", "success"); // Context checked in validateFull
            return { intent, artifact: response, steps, metrics: { durationMs: performance.now() - start } };
        } else {
            // If valid structure but invalid logic
            updateStep(steps, "Parse", validation.stage === "parse" ? "failure" : "success");
            if (validation.stage !== "parse") {
                updateStep(steps, "Context", "failure", validation.error);
            } else {
                updateStep(steps, "Parse", "failure", validation.error);
            }

            // RETRY LOOP (Simplified for V2)
            console.warn("Validation failed, retrying...");
            updateStep(steps, "Generation", "running", "Retrying correction...");

            messages.push(
                { role: "assistant", content: response },
                { role: "system", content: `CRITICAL ERROR: ${validation.error}. Fix the diff.` }
            );

            try {
                response = await callModel(ai, model, messages);
                // Re-validate
                const v2 = validateFull(response, allowedFiles, files);
                if (v2.valid) {
                    updateStep(steps, "Generation", "success", "Corrected");
                    updateStep(steps, "Structure", "success");
                    updateStep(steps, "Parse", "success");
                    updateStep(steps, "Context", "success");
                    return { intent, artifact: response, steps, metrics: { durationMs: performance.now() - start } };
                } else {
                    updateStep(steps, "Context", "failure", "Retry failed: " + v2.error);
                }
            } catch (e) {
                // ignore
            }
        }
    }

    return {
        intent,
        error: {
            type: "Validation",
            message: "Failed to generate valid patch",
            details: response
        },
        steps,
        metrics: { durationMs: performance.now() - start }
    };
}

function updateStep(steps: ValidationStep[], name: string, status: any, message?: string) {
    const step = steps.find(s => s.name === name);
    if (step) {
        step.status = status;
        if (message) step.message = message;
    }
}

async function callModel(ai: Ai, model: string, messages: any[]): Promise<string> {
    const response = await ai.run(model, { messages });
    return typeof response === "string" ? response : response.response || "";
}
