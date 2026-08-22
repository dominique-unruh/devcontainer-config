import { z } from "zod";
import { jobStore } from "../jobs.js";

export const waitShape = {
  ids: z.array(z.string()).describe("Command ids to wait on."),
  timeout: z.number().describe("Seconds to wait before giving up, even if none of the ids have finished."),
};

const WaitArgs = z.object(waitShape);

function terminal(id: string): boolean {
  const job = jobStore.get(id);
  return job !== undefined && (job.status === "finished" || job.status === "rejected");
}

/**
 * Block until any of `ids` reaches a terminal state (finished/rejected), or `timeout` seconds elapse.
 * Returns current records for every id passed in, so the caller can see which one(s) resolved and
 * re-call with the remaining ids to keep waiting on the rest.
 */
export async function wait(rawArgs: z.infer<typeof WaitArgs>) {
  const args = WaitArgs.parse(rawArgs);

  if (!args.ids.some(terminal)) {
    await new Promise<void>((resolveWait) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        jobStore.events.off("change", onChange);
        resolveWait();
      };
      const onChange = () => {
        if (args.ids.some(terminal)) finish();
      };
      jobStore.events.on("change", onChange);
      const timer = setTimeout(finish, args.timeout * 1000);
      timer.unref();
    });
  }

  const records = args.ids.map((id) => {
    const job = jobStore.get(id);
    if (!job) return { id, error: "unknown id" };
    return { id: job.id, tool: job.tool, status: job.status, note: job.note, result: job.result };
  });
  return { content: [{ type: "text" as const, text: JSON.stringify(records, null, 2) }] };
}
