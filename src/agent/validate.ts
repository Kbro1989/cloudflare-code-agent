import { parsePatch } from "diff";

export type ValidationResult =
    | { valid: true; parsed: any[] }
    | { valid: false; stage: "structure" | "parse" | "context"; error: string; details?: string };

export function validateFull(
    modelOutput: string,
    allowedFiles: Set<string>,
    providedFiles: Record<string, string>
): ValidationResult {
    // Stage 1: Structure
    const hasDiffHeader = modelOutput.includes("diff --git");
    const hasMarkers = modelOutput.includes("+++ ") && modelOutput.includes("--- ");
    if (!hasDiffHeader || !hasMarkers) {
        return {
            valid: false,
            stage: "structure",
            error: "Invalid diff structure",
            details: hasMarkers ? "Missing 'diff --git' header" : "No diff markers detected"
        };
    }

    // Stage 2: Parse + Allowlist
    let patches: any[];
    try {
        patches = parsePatch(modelOutput);
    } catch (e) {
        return { valid: false, stage: "parse", error: "Parse failed", details: String(e) };
    }

    if (patches.length === 0) {
        return { valid: false, stage: "parse", error: "No hunks found" };
    }

    const modifiedFiles = new Set(
        patches
            .flatMap(p => [normalizeFile(p.oldFileName), normalizeFile(p.newFileName)])
            .filter(Boolean)
    ) as Set<string>;

    for (const file of modifiedFiles) {
        if (!allowedFiles.has(file)) {
            return { valid: false, stage: "parse", error: "Unauthorized file modification", details: file };
        }
    }

    // Stage 3: Context verification
    const contextCheck = verifyContext(patches, providedFiles);
    if (!contextCheck.valid) {
        return { valid: false, stage: "context", error: contextCheck.error, details: contextCheck.details };
    }

    return { valid: true, parsed: patches };
}

function normalizeFile(f?: string): string | null {
    if (!f || f === "/dev/null") return null;
    return f.replace(/^a\/|^b\//, "");
}

function verifyContext(
    patches: any[],
    providedFiles: Record<string, string>
): { valid: true } | { valid: false; error: string; details: string } {
    for (const patch of patches) {
        const fileName = normalizeFile(patch.newFileName);
        if (!fileName) continue;

        const source = providedFiles[fileName];
        if (!source) continue; // new file

        const sourceLines = source.split("\n");

        for (const hunk of patch.hunks) {
            let sourceIndex = hunk.oldStart - 1;

            for (const line of hunk.lines) {
                if (line.startsWith(" ")) {
                    const contextLine = line.slice(1);
                    let matched = false;
                    const scanLimit = 5;
                    for (let i = sourceIndex; i < Math.min(sourceIndex + scanLimit, sourceLines.length); i++) {
                        if (sourceLines[i] === contextLine) {
                            sourceIndex = i;
                            matched = true;
                            break;
                        }
                    }
                    if (!matched) {
                        return {
                            valid: false,
                            error: "Context mismatch",
                            details: `File: ${fileName}, near line ${sourceIndex + 1}, expected: "${contextLine}"`
                        };
                    }
                }
                if (!line.startsWith("+")) {
                    sourceIndex++;
                }
            }
        }
    }
    return { valid: true };
}
