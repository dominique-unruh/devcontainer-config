import { z } from "zod";
import { shellStore } from "../shells.js";
import { runBashContainer as execBashContainer, type ExecResult } from "../devcontainerExec.js";

/** Default foreground timeout when none is given, matching the built-in Bash tool (2 minutes). */
const DEFAULT_TIMEOUT_MS = 120_000;
/** Hard cap on the foreground timeout, matching the built-in Bash tool (10 minutes). */
const MAX_TIMEOUT_MS = 600_000;

export const runBashContainerShape = {
  command: z
    .string()
    .describe(
      "Bash script to run inside the project's devcontainer (bash -e -c, via `devcontainer exec`). " +
        "No approval needed — freely install tools with sudo, explore, iterate. This is the default " +
        "way to run shell commands; the built-in Bash tool is host-only and gated."
    ),
  description: z
    .string()
    .optional()
    .describe("Clear, concise description of what this command does in 5-10 words."),
  timeout: z
    .number()
    .optional()
    .describe(
      "Optional timeout in milliseconds (default 120000, max 600000). Applies to a foreground call; a " +
        "background command runs until it finishes or is killed."
    ),
  run_in_background: z
    .boolean()
    .optional()
    .describe(
      "Set to true to run this command in the background. Returns a shell id immediately; read its " +
        "output later with bash_output and stop it with kill_shell."
    ),
};

const RunBashContainerArgs = z.object(runBashContainerShape);

/** Render a finished foreground command's output the way the built-in Bash tool does: stdout, then stderr, then a footer only when it didn't exit cleanly. */
function formatForeground(r: ExecResult): string {
  const sections: string[] = [];
  if (r.stdout) sections.push(r.stdout);
  if (r.stderr) sections.push(r.stderr);
  let text = sections.join("\n");

  if (r.timedOut) {
    text += `${text ? "\n\n" : ""}Command timed out and was killed.`;
  } else if (r.killed) {
    text += `${text ? "\n\n" : ""}Command was killed before it finished.`;
  } else if (r.exitCode !== 0) {
    text += `${text ? "\n\n" : ""}Exit code: ${r.exitCode}`;
  }

  return text || "(no output)";
}

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

/**
 * MCP tool handler for `run_bash_container`, shaped after the built-in Bash tool: run a shell command
 * inside the project's devcontainer (no approval required). Foreground calls block and return the
 * command's output inline; `run_in_background` returns a shell id to read from with `bash_output`.
 */
export async function runBashContainer(rawArgs: z.infer<typeof RunBashContainerArgs>) {
  const args = RunBashContainerArgs.parse(rawArgs);

  if (args.run_in_background) {
    // No default timeout in the background: it runs until it finishes or is killed. An explicit
    // timeout is still honored (clamped) as a safety valve.
    const timeoutMs = args.timeout !== undefined ? Math.min(args.timeout, MAX_TIMEOUT_MS) : undefined;
    const handle = execBashContainer(args.command, timeoutMs);
    const rec = shellStore.register({ command: args.command, description: args.description, handle });
    return text(
      `Command running in the background with shell ID: ${rec.id}\n` +
        `Read its output with bash_output (bash_id: "${rec.id}"); stop it with kill_shell (shell_id: "${rec.id}").`
    );
  }

  const timeoutMs = Math.min(args.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const result = await execBashContainer(args.command, timeoutMs).result;
  return text(formatForeground(result));
}
