import { jobStore } from "../jobs.js";

export const runningShape = {};

/** MCP tool handler for `running`: returns the ids of all commands currently in status `running`. No args needed. */
export async function running(_rawArgs: Record<string, never>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(jobStore.runningIds(), null, 2) }] };
}
