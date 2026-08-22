import { z } from "zod";
import { jobStore } from "../jobs.js";

export const killShape = {
  id: z.string().describe("Command id to cancel."),
};

const KillArgs = z.object(killShape);

/** MCP tool handler for `kill`: cancels a pending or running command (rejects it if not yet started, sends a kill signal if already running). */
export async function kill(rawArgs: z.infer<typeof KillArgs>) {
  const args = KillArgs.parse(rawArgs);
  const job = jobStore.kill(args.id);
  return {
    content: [
      { type: "text" as const, text: JSON.stringify({ id: job.id, status: job.status, note: job.note }, null, 2) },
    ],
  };
}
