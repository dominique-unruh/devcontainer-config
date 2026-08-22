import { jobStore, type JobStatus } from "../src/jobs.js";

/** Poll the shared jobStore until a job reaches one of the given terminal-ish statuses, or time out. */
export async function waitForJobStatus(
  id: string,
  statuses: JobStatus[],
  timeoutMs = 2000
): Promise<ReturnType<typeof jobStore.get>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = jobStore.get(id);
    if (job && statuses.includes(job.status)) return job;
    if (Date.now() > deadline) {
      throw new Error(`job ${id} did not reach [${statuses.join(", ")}] within ${timeoutMs}ms (status: ${job?.status})`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Parse the JSON text out of an MCP tool call's content array. */
export function parseToolResult<T = unknown>(result: { content: Array<{ type: string; text?: string }> }): T {
  const text = result.content[0]?.text;
  if (typeof text !== "string") throw new Error("tool result had no text content");
  return JSON.parse(text) as T;
}
