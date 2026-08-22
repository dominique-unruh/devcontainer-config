import { describe, it, expect, vi } from "vitest";
import { jobStore } from "../src/jobs.js";
import { submitJob, ApprovalUiUnavailableError } from "../src/toolRunner.js";
import { ensureWindowOpen } from "../src/ui/window.js";

describe("submitJob approval-UI failure", () => {
  it("throws with the dashboard URL instead of hanging when the approval window can't open", async () => {
    vi.mocked(ensureWindowOpen).mockResolvedValueOnce({ ok: false, error: "no display available" });
    const execute = vi.fn(() => ({ resultPromise: Promise.resolve({ exitCode: 0 }), kill: () => {} }));

    const promise = submitJob(
      { tool: "run_bash_host", needsApproval: true, reason: "r", summary: "ui-fails" },
      execute
    );

    await expect(promise).rejects.toThrow(ApprovalUiUnavailableError);
    await expect(promise).rejects.toThrow(/no display available/);
    await expect(promise).rejects.toThrow(/http:\/\/127\.0\.0\.1:\d+/);
    expect(execute).not.toHaveBeenCalled();

    // The job stays queued, so approving via a manually-opened dashboard still works.
    const job = jobStore.list().find((j) => j.summary === "ui-fails")!;
    expect(job.status).toBe("waiting-approval");
  });

  it("does not consult the approval window for tools that need no approval", async () => {
    vi.mocked(ensureWindowOpen).mockClear();
    await submitJob({ tool: "run_bash_container", needsApproval: false, summary: "no-ui-needed" }, () => ({
      resultPromise: Promise.resolve({ exitCode: 0 }),
      kill: () => {},
    }));
    expect(ensureWindowOpen).not.toHaveBeenCalled();
  });
});

describe("submitJob", () => {
  it("runs immediately and returns the result when no approval/deps are needed", async () => {
    const outcome = await submitJob(
      { tool: "run_bash_container", needsApproval: false, summary: "echo hi" },
      () => ({ resultPromise: Promise.resolve({ exitCode: 0 }), kill: () => {} })
    );
    expect(outcome).toMatchObject({ background: false, status: "finished", result: { exitCode: 0 } });
  });

  it("background:true returns just the id immediately, without invoking execute yet", async () => {
    const execute = vi.fn(() => ({ resultPromise: new Promise(() => {}), kill: () => {} }));
    const outcome = await submitJob(
      { tool: "run_bash_host", needsApproval: true, reason: "r", summary: "x", background: true },
      execute
    );
    expect(outcome.background).toBe(true);
    expect("id" in outcome).toBe(true);
    // still waiting-approval, execute must not have run yet
    const job = jobStore.get((outcome as { id: string }).id)!;
    expect(job.status).toBe("waiting-approval");
    expect(execute).not.toHaveBeenCalled();
  });

  it("a foreground call blocks until the job is approved, then runs execute", async () => {
    const execute = vi.fn(() => ({ resultPromise: Promise.resolve({ exitCode: 0 }), kill: () => {} }));
    const promise = submitJob(
      { tool: "run_bash_host", needsApproval: true, reason: "r", summary: "block-until-approved" },
      execute
    );
    // give submitJob a tick to create the job and start waiting
    await new Promise((r) => setTimeout(r, 10));
    expect(execute).not.toHaveBeenCalled();
    const jobs = jobStore.list().filter((j) => j.summary === "block-until-approved");
    expect(jobs).toHaveLength(1);
    jobStore.approve(jobs[0].id);

    const outcome = await promise;
    expect(execute).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ background: false, status: "finished", result: { exitCode: 0 } });
  });

  it("a rejected job resolves with status rejected and never calls execute", async () => {
    const execute = vi.fn(() => ({ resultPromise: Promise.resolve({ exitCode: 0 }), kill: () => {} }));
    const promise = submitJob(
      { tool: "run_bash_host", needsApproval: true, reason: "r", summary: "reject-me" },
      execute
    );
    await new Promise((r) => setTimeout(r, 10));
    const job = jobStore.list().find((j) => j.summary === "reject-me")!;
    jobStore.reject(job.id, "no");

    const outcome = await promise;
    expect(outcome).toMatchObject({ background: false, status: "rejected", note: "no" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("wires execute's kill() into jobStore.kill() while the job is running", async () => {
    const kill = vi.fn();
    let resolveResult!: (v: unknown) => void;
    const execute = vi.fn(() => ({
      resultPromise: new Promise((r) => (resolveResult = r)),
      kill,
    }));
    const promise = submitJob(
      { tool: "run_bash_container", needsApproval: false, summary: "long-running" },
      execute
    );
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
