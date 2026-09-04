import { EventEmitter } from "node:events";

export type JobStatus = "waiting-dependencies" | "running" | "finished" | "rejected";

export type ToolName = "run_bash_container";

export interface JobRecord {
  id: string;
  tool: ToolName;
  /** Short, human-readable summary of what this command does. */
  summary: string;
  after: string[];
  status: JobStatus;
  note?: string;
  result?: unknown;
  createdAt: number;
  /** Set once the job actually starts running (its dependency gate resolved) — this is when a timeout clock starts. */
  startedAt?: number;
  /** Called once when the job is killed while running, to let the tool implementation abort its child process. */
  onKill?: () => void;
  /** Subscribers waiting on this job's terminal state. */
  waiters: Array<() => void>;
}

/**
 * Whether a finished job actually succeeded: for bash results, `exitCode === 0` (a null exit code —
 * from a timeout or kill — counts as failure); otherwise the absence of an `error` field.
 * Non-finished jobs are never "succeeded".
 */
function didSucceed(job: JobRecord): boolean {
  if (job.status !== "finished") return false;
  const r = job.result as { exitCode?: number | null; error?: string } | undefined;
  if (!r) return true;
  if ("exitCode" in r) return r.exitCode === 0;
  if (r.error) return false;
  return true;
}

/** Build the cascade-rejection note for a finished-but-failed dependency. */
function failureNote(job: JobRecord): string {
  const r = job.result as { exitCode?: number | null; error?: string } | undefined;
  if (r && "exitCode" in r) {
    return `Command ${job.id} failed (exit code ${r.exitCode})`;
  }
  if (r && r.error) {
    return `Command ${job.id} failed: ${r.error}`;
  }
  return `Command ${job.id} failed`;
}

export class JobStore {
  private jobs = new Map<string, JobRecord>();
  /** Source of consecutive job ids ("1", "2", …) — short enough to read out and type by hand. */
  private nextId = 1;
  /** ids of jobs that depend on this id, for cascade propagation */
  private dependents = new Map<string, Set<string>>();
  /** Fires "change" on every mutation (create/reject/finish) — for anything that needs to observe the whole store, e.g. `wait`. */
  public readonly events = new EventEmitter();

  private emitChange() {
    this.events.emit("change");
  }

  /** Create a new job record, wire up its `after` dependency links, and compute its initial status. */
  create(params: { tool: ToolName; summary: string; after?: string[] }): JobRecord {
    const id = String(this.nextId++);
    const after = params.after ?? [];
    const job: JobRecord = {
      id,
      tool: params.tool,
      summary: params.summary,
      after,
      status: "waiting-dependencies",
      createdAt: Date.now(),
      waiters: [],
    };
    this.jobs.set(id, job);
    for (const depId of after) {
      if (!this.dependents.has(depId)) this.dependents.set(depId, new Set());
      this.dependents.get(depId)!.add(id);
    }
    this.recomputeStatus(job);
    this.emitChange();
    return job;
  }

  /** Look up a job by id, or undefined if it doesn't exist. */
  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  /** All job records, in no particular order. */
  list(): JobRecord[] {
    return [...this.jobs.values()];
  }

  /** Evaluate the dependency gate for a job: are all `after` ids satisfied, still pending, or has one failed/been rejected? */
  private depsSatisfied(job: JobRecord): "pending" | "satisfied" | "failed" {
    for (const depId of job.after) {
      const dep = this.jobs.get(depId);
      if (!dep) continue; // unknown id: treat as already satisfied, nothing to wait on
      if (dep.status === "rejected") return "failed";
      if (dep.status === "finished") {
        if (!didSucceed(dep)) return "failed";
        continue;
      }
      return "pending";
    }
    return "satisfied";
  }

  /** Recompute a job's displayed status from its dependency gate. Call after any gate-affecting change. */
  private recomputeStatus(job: JobRecord) {
    if (job.status === "finished" || job.status === "rejected") return;

    const deps = this.depsSatisfied(job);
    if (deps === "failed") {
      // find the failed/rejected dep to build the note
      const cause = job.after
        .map((id) => this.jobs.get(id))
        .find((d) => d && (d.status === "rejected" || (d.status === "finished" && !didSucceed(d))));
      const note = cause
        ? cause.status === "rejected"
          ? `Command ${cause.id} was rejected`
          : failureNote(cause)
        : "A dependency failed";
      this.reject(job.id, note, /*internal*/ true);
      return;
    }

    if (deps === "pending") {
      job.status = "waiting-dependencies";
    } else if (job.status !== "running") {
      job.status = "running";
      job.startedAt = Date.now();
    }
  }

  /** Called by a tool implementation once the dependency gate is open, to get the started/running job and proceed. Returns a promise resolved when running starts (or already resolved). */
  async waitUntilRunningOrTerminal(id: string): Promise<JobRecord> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Unknown job id ${id}`);
    if (job.status === "running" || job.status === "finished" || job.status === "rejected") {
      return job;
    }
    return new Promise((resolve) => {
      const check = () => {
        const j = this.jobs.get(id)!;
        if (j.status === "running" || j.status === "finished" || j.status === "rejected") {
          resolve(j);
        } else {
          job.waiters.push(check);
        }
      };
      job.waiters.push(check);
    });
  }

  /** Reject a job (direct, or `internal:true` for a cascade/kill-triggered rejection), and cascade to anything depending on it. */
  reject(id: string, note: string | undefined, internal = false): JobRecord {
    const job = this.mustGet(id);
    if (job.status === "finished" || job.status === "rejected") {
      if (!internal) throw new Error(`Job ${id} is already terminal (status: ${job.status})`);
      return job;
    }
    job.status = "rejected";
    job.note = note;
    this.cascadeReject(job.id);
    this.notifyWaiters(job);
    this.emitChange();
    return job;
  }

  /** Re-evaluate every job that lists `id` in its `after`, since `id` just changed state. */
  private cascadeReject(id: string) {
    const dependentIds = this.dependents.get(id);
    if (!dependentIds) return;
    for (const depId of dependentIds) {
      const dep = this.jobs.get(depId);
      if (!dep) continue;
      const before = dep.status;
      this.recomputeStatus(dep);
      if (dep.status !== before) this.notifyWaiters(dep);
    }
  }

  /** Mark a job finished with its result, wake its own waiters, and cascade-check dependents (a failed result can reject them). */
  finish(id: string, result: unknown): JobRecord {
    const job = this.mustGet(id);
    job.status = "finished";
    job.result = result;
    this.notifyWaiters(job);
    // a finished-but-failed job can cascade-reject dependents too
    this.cascadeReject(job.id);
    this.emitChange();
    return job;
  }

  /** Register the callback a running job's kill() should invoke to abort its underlying work. */
  setOnKill(id: string, onKill: () => void) {
    const job = this.mustGet(id);
    job.onKill = onKill;
  }

  /** Cancel a job: reject outright if it hasn't started running yet, otherwise invoke its registered kill handler (the handler's own completion will later call `finish` with `killed: true`). */
  kill(id: string): JobRecord {
    const job = this.mustGet(id);
    if (job.status === "finished" || job.status === "rejected") {
      throw new Error(`Job ${id} is already terminal (status: ${job.status})`);
    }
    if (job.status === "running") {
      if (!job.onKill) {
        throw new Error(`Job ${id} is running but has no kill handler registered`);
      }
      job.onKill();
      // the running process's own completion handler will call finish() with killed:true
      return job;
    }
    return this.reject(id, "Killed via kill command before dependencies finished");
  }

  /** Ids of every job currently in status `running`. */
  runningIds(): string[] {
    return this.list()
      .filter((j) => j.status === "running")
      .map((j) => j.id);
  }

  /** Fire and clear a job's `waitUntilRunningOrTerminal` subscribers. */
  private notifyWaiters(job: JobRecord) {
    const waiters = job.waiters;
    job.waiters = [];
    for (const w of waiters) w();
  }

  /** Like `get`, but throws for an unknown id instead of returning undefined. */
  private mustGet(id: string): JobRecord {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Unknown job id ${id}`);
    return job;
  }
}

export const jobStore = new JobStore();
