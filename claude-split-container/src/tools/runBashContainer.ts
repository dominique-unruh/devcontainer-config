import { z } from "zod";
import { submitJob } from "../toolRunner.js";
import { runBashContainer as execBashContainer } from "../devcontainerExec.js";

export const runBashContainerShape = {
  command: z
    .string()
    .describe(
      "Bash script to run inside the project's devcontainer (bash -e -c, via `devcontainer exec`). " +
        "No approval needed — freely install tools with sudo, explore, iterate. Prefer this over " +
        "run_bash_host whenever the task doesn't specifically require the host."
    ),
  background: z
    .boolean()
    .optional()
    .describe("If true, return immediately with just an id; poll with status/wait later."),
  timeout: z
    .number()
    .optional()
    .describe(
      "Seconds allowed once the command actually starts running (clock starts once dependencies are " +
        "satisfied, not at submission). Mandatory unless background is true."
    ),
  after: z.array(z.string()).optional().describe("Command ids that must all succeed before this one starts."),
};

const RunBashContainerArgs = z.object(runBashContainerShape);

/** MCP tool handler for `run_bash_container`: runs a shell command inside the project's devcontainer, no approval required. */
export async function runBashContainer(rawArgs: z.infer<typeof RunBashContainerArgs>) {
  const args = RunBashContainerArgs.parse(rawArgs);
  if (!args.background && args.timeout === undefined) {
    throw new Error("timeout is mandatory for foreground (non-background) run_bash_container calls");
  }

  const outcome = await submitJob(
    {
      tool: "run_bash_container",
      needsApproval: false,
      summary: args.command,
      after: args.after,
      background: args.background,
    },
    () => {
      const handle = execBashContainer(args.command, args.timeout !== undefined ? args.timeout * 1000 : undefined);
      const resultPromise = handle.result.then((r) => ({
        exitCode: r.exitCode,
        timedOut: r.timedOut || undefined,
        killed: r.killed || undefined,
        stdout: r.stdout,
        stderr: r.stderr,
      }));
      return { resultPromise, kill: handle.kill };
    }
  );

  return { content: [{ type: "text" as const, text: JSON.stringify(outcome, null, 2) }] };
}
