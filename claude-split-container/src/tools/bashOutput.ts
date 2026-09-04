import { z } from "zod";
import { shellStore } from "../shells.js";

export const bashOutputShape = {
  bash_id: z.string().describe("The ID of the background shell to read output from."),
  filter: z
    .string()
    .optional()
    .describe(
      "Optional regular expression to filter the output lines. Only lines matching the regex are " +
        "returned; the read cursor still advances past all output."
    ),
};

const BashOutputArgs = z.object(bashOutputShape);

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

/**
 * MCP tool handler for `bash_output`, shaped after the built-in BashOutput tool: return the output a
 * background shell has produced since the last read (only what's new), plus its status and — once it
 * has exited — its exit code.
 */
export async function bashOutput(rawArgs: z.infer<typeof BashOutputArgs>) {
  const args = BashOutputArgs.parse(rawArgs);
  const out = shellStore.readNew(args.bash_id, args.filter);
  if (!out) return text(`No background shell with ID: ${args.bash_id}`);

  const lines: string[] = [`<status>${out.status}</status>`];
  if (out.status !== "running") {
    if (out.timedOut) lines.push(`<exit_code>timed out</exit_code>`);
    else if (out.exitCode !== undefined && out.exitCode !== null) lines.push(`<exit_code>${out.exitCode}</exit_code>`);
    else lines.push(`<exit_code>killed</exit_code>`);
  }
  lines.push(`<stdout>\n${out.stdout}\n</stdout>`);
  lines.push(`<stderr>\n${out.stderr}\n</stderr>`);
  return text(lines.join("\n"));
}
