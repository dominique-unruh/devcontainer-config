import { z } from "zod";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { copyFile, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { submitJob } from "../toolRunner.js";
import { PROJECT_DIR } from "../sharedDir.js";

export const patchFileShape = {
  targetPath: z.string().describe("Absolute path (or path relative to the project dir) of the host file to patch."),
  patch: z.string().describe("Unified diff to apply to targetPath. Preferred over write_file for editing existing text files — auditable at a glance."),
  reason: z.string().describe("Markdown explanation of why this patch is needed, shown to the human approving it."),
  background: z
    .boolean()
    .optional()
    .describe("If true, return immediately with just an id; poll with status/wait later."),
  after: z.array(z.string()).optional().describe("Command ids that must all succeed before this one starts."),
};

const PatchFileArgs = z.object(patchFileShape);

/** Run POSIX `patch` against `targetPath` with the given diff text on stdin. Resolves with exit code and combined output. */
function runPatch(
  targetPath: string,
  patchText: string,
  dryRun: boolean
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolveRun) => {
    const args = dryRun ? ["--dry-run", "-p1", targetPath] : ["-p1", targetPath];
    const child = spawn("patch", args, { cwd: PROJECT_DIR, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => (output += d.toString()));
    child.stderr.on("data", (d) => (output += d.toString()));
    // A missing `patch` binary emits 'error'; unhandled, that would crash the whole MCP server.
    child.on("error", (err) => resolveRun({ code: null, output: `could not run \`patch\`: ${err.message}` }));
    child.on("close", (code) => resolveRun({ code, output }));
    child.stdin.on("error", () => {}); // the process may be gone before stdin is written
    child.stdin.write(patchText);
    child.stdin.end();
  });
}

/** MCP tool handler for `patch_file`: applies a unified diff to a host file after human approval, atomically (dry-run first, backup + restore on unexpected failure). */
export async function patchFile(rawArgs: z.infer<typeof PatchFileArgs>) {
  const args = PatchFileArgs.parse(rawArgs);
  const targetAbsPath = resolve(PROJECT_DIR, args.targetPath);
  const summary = `Patch ${targetAbsPath}:\n${args.patch}`;

  const outcome = await submitJob(
    {
      tool: "patch_file",
      needsApproval: true,
      reason: args.reason,
      summary,
      after: args.after,
      background: args.background,
    },
    () => {
      const resultPromise = (async () => {
        const dryRun = await runPatch(targetAbsPath, args.patch, true);
        if (dryRun.code !== 0) {
          return { error: `patch does not apply (dry-run failed): ${dryRun.output.trim()}` };
        }

        const backupPath = `${targetAbsPath}.claude-split-container-backup-${randomBytes(4).toString("hex")}`;
        await copyFile(targetAbsPath, backupPath);
        try {
          const real = await runPatch(targetAbsPath, args.patch, false);
          if (real.code !== 0) {
            await copyFile(backupPath, targetAbsPath);
            return { error: `patch apply failed unexpectedly after a clean dry-run, restored backup: ${real.output.trim()}` };
          }
          return { applied: true };
        } finally {
          await unlink(backupPath).catch(() => {});
        }
      })();
      // patch is effectively instantaneous; nothing meaningful to cancel mid-flight.
      return { resultPromise, kill: () => {} };
    }
  );

  return { content: [{ type: "text" as const, text: JSON.stringify(outcome, null, 2) }] };
}
