import { z } from "zod";
import { submitJob } from "../toolRunner.js";
import { runBashHost as execBashHost } from "../devcontainerExec.js";
import { writeTmpFile } from "../sharedDir.js";

export const runBashHostShape = {
  command: z
    .string()
    .describe(
      "Bash script to run on the HOST machine (bash -e -c). Keep it simple and auditable: " +
        "decompose pipelines into separate calls (a plain host command, then a container command " +
        "to filter/inspect its output) rather than long chains — a human must read and approve this " +
        "in seconds. Separate multiple statements with newlines, not ';'/'&&'."
    ),
  reason: z.string().describe("Markdown explanation of why this command is needed, shown to the human approving it."),
  background: z
    .boolean()
    .optional()
    .describe(
      "If true, return immediately with just an id, before approval even happens; poll with status/wait later. " +
        "Useful for batching several independent approvals together instead of blocking one at a time."
    ),
  timeout: z
    .number()
    .optional()
    .describe(
      "Seconds allowed once the command actually starts running (clock starts at approval + " +
        "dependencies-satisfied, not at submission). Mandatory unless background is true."
    ),
  after: z.array(z.string()).optional().describe("Command ids that must all succeed before this one starts."),
};

const RunBashHostArgs = z.object(runBashHostShape);

/** MCP tool handler for `run_bash_host`: runs a shell command on the host after human approval, writing stdout/stderr to `.tmp`. */
export async function runBashHost(rawArgs: z.infer<typeof RunBashHostArgs>) {
  const args = RunBashHostArgs.parse(rawArgs);
  if (!args.background && args.timeout === undefined) {
    throw new Error("timeout is mandatory for foreground (non-background) run_bash_host calls");
  }

  const outcome = await submitJob(
    {
      tool: "run_bash_host",
      needsApproval: true,
      reason: args.reason,
      summary: args.command,
      after: args.after,
      background: args.background,
    },
    (job) => {
      const handle = execBashHost(args.command, args.timeout !== undefined ? args.timeout * 1000 : undefined);
      const resultPromise = handle.result.then(async (r) => {
        const ts = Date.now();
        const stdoutFile = await writeTmpFile(`${ts}-${job.id}`, ".stdout", r.stdout);
        const stderrFile = await writeTmpFile(`${ts}-${job.id}`, ".stderr", r.stderr);
        return {
          exitCode: r.exitCode,
          timedOut: r.timedOut || undefined,
          killed: r.killed || undefined,
          stdoutFile,
          stderrFile,
        };
      });
      return { resultPromise, kill: handle.kill };
    }
  );

  return { content: [{ type: "text" as const, text: JSON.stringify(outcome, null, 2) }] };
}
