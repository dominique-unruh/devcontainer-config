import { shellStore } from "../shells.js";

export const listBackgroundRunningShape = {};

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

/** One-line label for a running shell: its id and its description, falling back to a snippet of the command. */
function label(rec: { id: string; description?: string; command: string }): string {
  const what = rec.description ?? rec.command.split("\n", 1)[0].slice(0, 80);
  return `${rec.id}: ${what}`;
}

/**
 * MCP tool handler for `list_background_running`: list the background shells (started with
 * run_bash_container `run_in_background`) that are still running. No args needed.
 */
export async function listBackgroundRunning(_rawArgs: Record<string, never>) {
  const running = shellStore.runningShells();
  if (running.length === 0) return text("No background shells are running.");
  return text(running.map(label).join("\n"));
}
