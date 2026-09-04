import { z } from "zod";
import { shellStore } from "../shells.js";

export const waitShape = {
  bash_id: z.string().describe("The ID of the background shell to wait on."),
  timeout: z
    .number()
    .describe("Milliseconds to wait for the shell to finish before giving up and returning its current status."),
};

const WaitArgs = z.object(waitShape);

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

/**
 * MCP tool handler for `wait`: block until a background shell finishes (or `timeout` ms elapse), then
 * report its status and exit code. Does not consume the shell's output buffer — read it with
 * bash_output. Unlike the built-in Bash tools (where the harness auto-notifies on completion), an MCP
 * server can't push, so this is the blocking alternative to polling bash_output.
 */
export async function wait(rawArgs: z.infer<typeof WaitArgs>) {
  const args = WaitArgs.parse(rawArgs);
  const rec = await shellStore.waitForTerminal(args.bash_id, args.timeout);
  if (!rec) return text(`No background shell with ID: ${args.bash_id}`);

  if (rec.status === "running") {
    return text(`Shell ${rec.id} still running after ${args.timeout}ms.\n<status>running</status>`);
  }

  const lines = [`<status>${rec.status}</status>`];
  if (rec.result?.timedOut) lines.push(`<exit_code>timed out</exit_code>`);
  else if (rec.result?.exitCode !== undefined && rec.result?.exitCode !== null)
    lines.push(`<exit_code>${rec.result.exitCode}</exit_code>`);
  else lines.push(`<exit_code>killed</exit_code>`);
  return text(lines.join("\n"));
}
