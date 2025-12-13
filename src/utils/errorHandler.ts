export function handleError(error: unknown): Response {
    if (error instanceof Error) {
        console.error("Error: ", error.message);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    } else {
        console.error("Unknown error: ", error);
        return new Response(JSON.stringify({ error: "An unknown error occurred." }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}