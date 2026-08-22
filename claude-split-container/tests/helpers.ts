import { readFile } from "node:fs/promises";
import { jobStore, type JobStatus } from "../src/jobs.js";
import type { DashboardHandle } from "../src/ui/dashboardServer.js";

/**
 * Walk the real browser entry flow: mint a bootstrap file, read the one-time token out of it,
 * redeem it at `/bootstrap`, and return the session cookie to send on subsequent requests.
 */
export async function redeemBootstrap(dashboard: DashboardHandle): Promise<string> {
  const { path } = await dashboard.newBootstrap();
  const target = bootstrapTargetOf(await readFile(path, "utf8"));
  const res = await fetch(target);
  if (res.status !== 200) throw new Error(`bootstrap redemption failed: ${res.status}`);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("bootstrap redemption set no cookie");
  return setCookie.split(";")[0];
}

/** Extract the `/bootstrap?t=…` URL the entry page redirects to. */
export function bootstrapTargetOf(page: string): string {
  const match = /url=([^"]+)/.exec(page);
  if (!match) throw new Error(`no redirect target in bootstrap page: ${page}`);
  return match[1];
}

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
