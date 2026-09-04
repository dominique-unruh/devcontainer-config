import { describe, it, expect, vi } from "vitest";
import { jobStore } from "../src/jobs.js";
import { submitJob } from "../src/toolRunner.js";

/** Submit a never-resolving background job and return its id — a handy stand-in for an unfinished dependency. */
async function pendingDep(summary: string): Promise<string> {
  const outcome = await submitJob({ tool: "run_bash_container", summary, background: true }, () => ({
    resultPromise: new Promise(() => {}),
    kill: () => {},
  }));
  return outcome.id;
}

describe("submitJob", () => {
  it("runs immediately and returns the result when no deps are pending", async () => {
    const outcome = await submitJob({ tool: "run_bash_container", summary: "echo hi" }, () => ({
      resultPromise: Promise.resolve({ exitCode: 0 }),
      kill: () => {},
    }));
    expect(outcome).toMatchObject({ background: false, status: "finished", result: { exitCode: 0 } });
  });

  it("background:true returns just the id immediately, without invoking execute while a dep is pending", async () => {
    const dep = await pendingDep("dep");
    const execute = vi.fn(() => ({ resultPromise: new Promise(() => {}), kill: () => {} }));
    const outcome = await submitJob(
      { tool: "run_bash_container", summary: "x", background: true, after: [dep] },
      execute
    );
    expect(outcome.background).toBe(true);
    const job = jobStore.get(outcome.id)!;
    expect(job.status).toBe("waiting-dependencies");
    expect(execute).not.toHaveBeenCalled();
  });

  it("a foreground call blocks until its dependency finishes, then runs execute", async () => {
    const dep = await pendingDep("dep-block");
    const execute = vi.fn(() => ({ resultPromise: Promise.resolve({ exitCode: 0 }), kill: () => {} }));
    const promise = submitJob(
      { tool: "run_bash_container", summary: "block-until-dep", after: [dep] },
      execute
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(execute).not.toHaveBeenCalled();
    jobStore.finish(dep, { exitCode: 0 });

    const outcome = await promise;
    expect(execute).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ background: false, status: "finished", result: { exitCode: 0 } });
  });

  it("a job whose dependency is rejected resolves rejected and never calls execute", async () => {
    const dep = await pendingDep("dep-reject");
    const execute = vi.fn(() => ({ resultPromise: Promise.resolve({ exitCode: 0 }), kill: () => {} }));
    const promise = submitJob(
      { tool: "run_bash_container", summary: "should-cascade", after: [dep] },
      execute
    );
    await new Promise((r) => setTimeout(r, 10));
    jobStore.reject(dep, "no");

    const outcome = await promise;
    expect(outcome).toMatchObject({ background: false, status: "rejected" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("wires execute's kill() into jobStore.kill() while the job is running", async () => {
    const kill = vi.fn();
    let resolveResult!: (v: unknown) => void;
    const execute = vi.fn(() => ({
      resultPromise: new Promise((r) => (resolveResult = r)),
      kill,
    }));
    const promise = submitJob({ tool: "run_bash_container", summary: "long-running" }, execute);
    await new Promise((r) => setTimeout(r, 10));
    const job = jobStore.list().find((j) => j.summary === "long-running")!;
    expect(job.status).toBe("running");
    jobStore.kill(job.id);
    expect(kill).toHaveBeenCalledTimes(1);

    resolveResult({ exitCode: null, killed: true });
    const outcome = await promise;
    expect(outcome).toMatchObject({ status: "finished", result: { killed: true } });
  });
});
