import { z } from "zod";
import { shellStore } from "../shells.js";

export const killShellShape = {
  shell_id: z.string().describe("The ID of the background shell to kill."),
};

const KillShellArgs = z.object(killShellShape);

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

/**
 * MCP tool handler for `kill_shell`, shaped after the built-in KillShell tool: send a kill signal to a
 * running background shell. Its status settles to `killed` once the underlying process actually exits.
 */
export async function killShell(rawArgs: z.infer<typeof KillShellArgs>) {
  const args = KillShellArgs.parse(rawArgs);
  const rec = shellStore.get(args.shell_id);
  if (!rec) return text(`No background shell with ID: ${args.shell_id}`);
  if (rec.status !== "running") return text(`Shell ${rec.id} already terminated (status: ${rec.status}).`);
  shellStore.kill(rec.id);
  return text(`Sent kill signal to shell ${rec.id}.`);
}
