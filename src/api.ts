import { Env } from "./types";
import { classifyIntent } from "./agent/classify";
import { generatePlan } from "./agent/plan"; // Fixed name
import { executeImplement } from "./agent/execute";

export async function handleRequest(request: Request, env: Env): Promise<Response> {
    try {
        const body = await request.json() as { prompt: string; session_id?: string };
        const { prompt, session_id } = body;

        if (!prompt) {
            return new Response("Missing prompt", { status: 400 });
        }

        // 1. Classify
        const classification = await classifyIntent(prompt);

        // 2. Plan (if needed)

        let result = "";

        if (classification === "implement" || classification === "debug" || classification === "optimize") { // classifyIntent returns string (Intent)
            // generatePlan is sync and takes string
            const planObj = generatePlan(prompt);
            const planStr = JSON.stringify(planObj);

            result = await executeImplement(env.AI, planStr, []);
        } else {
            result = "Chat/Question functionality not yet implemented.";
        }

        return new Response(JSON.stringify({
            intent: classification,
            result
        }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500 });
    }
}
