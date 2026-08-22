import { jobStore, type JobRecord, type ToolName } from "./jobs.js";
import { startDashboardServer, type DashboardHandle } from "./ui/dashboardServer.js";
import { ensureWindowOpen } from "./ui/window.js";

let dashboard: DashboardHandle | undefined;
let dashboardStarting: Promise<DashboardHandle> | undefined;

/** Start the dashboard HTTP server on first use (idempotent). */
export async function getDashboard(): Promise<DashboardHandle> {
  if (dashboard) return dashboard;
  if (!dashboardStarting) {
    dashboardStarting = startDashboardServer().then((d) => {
      dashboard = d;
      return d;
    });
  }
  return dashboardStarting;
}

/** Raised when a job needs human approval but no approval window could be opened for it. */
export class ApprovalUiUnavailableError extends Error {
  constructor(
    readonly jobId: string,
    readonly url: string,
    reason: string
  ) {
    super(
      `Approval UI could not be opened, so this command cannot be approved as-is: ${reason}\n\n` +
        `The command is queued (id: ${jobId}) and the approval dashboard is still served at:\n${url}\n\n` +
        `Tell the user to open that URL in a browser to approve or reject it — it will run as soon ` +
        `as they approve. Use status/wait with the id above to pick the result up afterwards.`
    );
    this.name = "ApprovalUiUnavailableError";
  }
}

export interface Execution {
  resultPromise: Promise<unknown>;
  /** Called if the job is killed while running. Must be safe to call even for work that can't really be cancelled (no-op is fine). */
  kill: () => void;
}

export interface SubmitParams {
  tool: ToolName;
  needsApproval: boolean;
  reason?: string;
  summary: string;
  after?: string[];
  background?: boolean;
}

export type SubmitOutcome =
  | { id: string; background: true }
  | { id: string; background: false; status: JobRecord["status"]; note?: string; result?: unknown };

/**
 * Create a job, then (in the background if requested, else inline) wait for
 * both gates to resolve, run `execute`, and record the result. `execute` is
 * only invoked once the job is actually in `running` status.
 */
export async function submitJob(
  params: SubmitParams,
  execute: (job: JobRecord) => Execution
): Promise<SubmitOutcome> {
  const dash = params.needsApproval ? await getDashboard() : undefined;

  const job = jobStore.create({
    tool: params.tool,
    needsApproval: params.needsApproval,
    reason: params.reason,
    summary: params.summary,
    after: params.after,
  });

  // Open the approval window *before* committing to wait on approval. If it can't be opened, the
  // human would never see the request, and the call would block forever — so surface it to the
  // caller instead of hanging silently.
  if (dash) {
    const launch = await ensureWindowOpen(dash.url);
    if (!launch.ok) {
      throw new ApprovalUiUnavailableError(job.id, dash.url, launch.error ?? "unknown reason");
    }
  }

  const run = async () => {
    const settled = await jobStore.waitUntilRunningOrTerminal(job.id);
    if (settled.status !== "running") return; // rejected before it could start (cascade or direct reject)
    const { resultPromise, kill } = execute(settled);
    jobStore.setOnKill(job.id, kill);
    const result = await resultPromise;
    jobStore.finish(job.id, result);
  };

  if (params.background) {
    void run();
    return { id: job.id, background: true };
  }

  await run();
  const final = jobStore.get(job.id)!;
  return { id: job.id, background: false, status: final.status, note: final.note, result: final.result };
}
