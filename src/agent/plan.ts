// Execution planner
// v1: single-step plan. Future: multi-step planning.

export interface Plan {
    intent: string;
    steps: string[];
    outputFormat: "diff" | "code" | "analysis";
}

export function generatePlan(intent: string): Plan {
    return {
        intent,
        steps: ["Apply requested change"],
        outputFormat: "diff"
    };
}
