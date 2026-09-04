import { jobStore, type JobRecord, type ToolName } from "./jobs.js";

export interface Execution {
  resultPromise: Promise<unknown>;
  /** Called if the job is killed while running. Must be safe to call even for work that can't really be cancelled (no-op is fine). */
  kill: () => void;
}

export interface SubmitParams {
  tool: ToolName;
  summary: string;
  after?: string[];
  background?: boolean;
}

export type SubmitOutcome =
  | { id: string; background: true }
  | {
      id: string;
      background: false;
      status: JobRecord["status"];
      note?: string;
      result?: unknown;
    };

/**
 * Create a job, then (in the background if requested, else inline) wait for its
 * dependency gate to resolve, run `execute`, and record the result. `execute` is
 * only invoked once the job is actually in `running` status.
 */
export async function submitJob(
  params: SubmitParams,
  execute: (job: JobRecord) => Execution
): Promise<SubmitOutcome> {
  const job = jobStore.create({
    tool: params.tool,
    summary: params.summary,
    after: params.after,
  });

  const run = async () => {
    const settled = await jobStore.waitUntilRunningOrTerminal(job.id);
    if (settled.status !== "running") return; // rejected before it could start (cascade or kill)
    const { resultPromise, kill } = execute(settled);
    jobStore.setOnKill(job.id, kill);
    jobStore.finish(job.id, await resultPromise);
  };

  if (params.background) {
    void run();
    return { id: job.id, background: true };
  }

  await run();
  const final = jobStore.get(job.id)!;
  return {
    id: job.id,
    background: false,
    status: final.status,
    note: final.note,
    result: final.result,
  };
}
