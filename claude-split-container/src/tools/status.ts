import { z } from "zod";
import { jobStore } from "../jobs.js";

export const statusShape = {
  ids: z.array(z.string()).describe("Command ids to look up."),
};

const StatusArgs = z.object(statusShape);

/** MCP tool handler for `status`: non-blocking lookup of the current record for each given command id. */
export async function status(rawArgs: z.infer<typeof StatusArgs>) {
  const args = StatusArgs.parse(rawArgs);
  const records = args.ids.map((id) => {
    const job = jobStore.get(id);
    if (!job) return { id, error: "unknown id" };
    return { id: job.id, tool: job.tool, status: job.status, note: job.note, result: job.result };
  });
  return { content: [{ type: "text" as const, text: JSON.stringify(records, null, 2) }] };
}
