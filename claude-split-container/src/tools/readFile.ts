import { z } from "zod";
import { resolve } from "node:path";
import { submitJob } from "../toolRunner.js";
import { copyIntoTmpDir, PROJECT_DIR } from "../sharedDir.js";

export const readFileShape = {
  path: z.string().describe("Absolute path (or path relative to the project dir) of the host file to read."),
  reason: z.string().describe("Markdown explanation of why this file is needed, shown to the human approving it."),
  background: z
    .boolean()
    .optional()
    .describe("If true, return immediately with just an id; poll with status/wait later."),
  after: z.array(z.string()).optional().describe("Command ids that must all succeed before this one starts."),
};

const ReadFileArgs = z.object(readFileShape);

/** MCP tool handler for `read_file`: copies a host file into the shared `.tmp` dir after human approval. */
export async function readFile(rawArgs: z.infer<typeof ReadFileArgs>) {
  const args = ReadFileArgs.parse(rawArgs);
  const absPath = resolve(PROJECT_DIR, args.path);

  const outcome = await submitJob(
    {
      tool: "read_file",
      needsApproval: true,
      reason: args.reason,
      summary: absPath,
      after: args.after,
      background: args.background,
    },
    () => {
      const resultPromise = copyIntoTmpDir(absPath)
        .then((file) => ({ file }))
        .catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));
      // Copies are effectively instantaneous; nothing meaningful to cancel mid-flight.
      return { resultPromise, kill: () => {} };
    }
  );

  return { content: [{ type: "text" as const, text: JSON.stringify(outcome, null, 2) }] };
}
