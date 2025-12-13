// Execution planner
// v1: single-step plan. Future: multi-step planning.

export interface Plan {
    intent: string;
    steps: string[];
    outputFormat: "diff" | "code" | "analysis";
}

export function generatePlan(intent: string): Plan {
    // In a real implementation, we would use the LLM here to generate this structure.
    // For now, we return a template that encourages the Agent to use file operations.

    return {
        intent,
        steps: [
            "Analyze the request",
            "CREATE: src/components/NewFeature.ts",
            "Update index.ts to export it"
        ],
        outputFormat: "diff"
    };
}
