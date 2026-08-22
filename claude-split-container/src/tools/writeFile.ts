import { z } from "zod";
import { resolve, dirname } from "node:path";
import { mkdir, writeFile as fsWriteFile, copyFile, stat } from "node:fs/promises";
import { submitJob } from "../toolRunner.js";
import { PROJECT_DIR, tmpFilePath } from "../sharedDir.js";

export const writeFileShape = {
  destPath: z.string().describe("Absolute path (or path relative to the project dir) to write on the host."),
  sharedFile: z
    .string()
    .optional()
    .describe(
      "File to copy from, as returned by read_file/run_bash_host (e.g. `.tmp/1787-2-ab12.stdout`); " +
        "a bare filename is also accepted. Mutually exclusive with `content`."
    ),
  content: z.string().optional().describe("Literal content to write directly. Mutually exclusive with `sharedFile`."),
  reason: z.string().describe("Markdown explanation of why this write is needed, shown to the human approving it."),
  background: z
    .boolean()
    .optional()
    .describe("If true, return immediately with just an id; poll with status/wait later."),
  after: z.array(z.string()).optional().describe("Command ids that must all succeed before this one starts."),
};

const WriteFileArgs = z.object(writeFileShape);

/** MCP tool handler for `write_file`: writes/copies content to a host path after human approval, from a shared-dir file or literal content. */
export async function writeFile(rawArgs: z.infer<typeof WriteFileArgs>) {
  const args = WriteFileArgs.parse(rawArgs);
  if ((args.sharedFile === undefined) === (args.content === undefined)) {
    throw new Error("write_file requires exactly one of `sharedFile` or `content`");
  }
  const destAbsPath = resolve(PROJECT_DIR, args.destPath);
  const summary = args.sharedFile
    ? `Write ${destAbsPath}\nfrom shared file: ${args.sharedFile}`
    : `Write ${destAbsPath}\ncontent:\n${args.content}`;

  const outcome = await submitJob(
    {
      tool: "write_file",
      needsApproval: true,
      reason: args.reason,
      summary,
      after: args.after,
      background: args.background,
    },
    () => {
      const resultPromise = (async () => {
        try {
          await mkdir(dirname(destAbsPath), { recursive: true });
          if (args.sharedFile !== undefined) {
            await copyFile(tmpFilePath(args.sharedFile), destAbsPath);
          } else {
            await fsWriteFile(destAbsPath, args.content!);
          }
          const st = await stat(destAbsPath);
          return { bytesWritten: st.size };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      })();
      // Writes are effectively instantaneous; nothing meaningful to cancel mid-flight.
      return { resultPromise, kill: () => {} };
    }
  );

  return { content: [{ type: "text" as const, text: JSON.stringify(outcome, null, 2) }] };
}
