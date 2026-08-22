import { describe, it, expect } from "vitest";
import { jobStore } from "../../src/jobs.js";
import { status } from "../../src/tools/status.js";
import { wait } from "../../src/tools/wait.js";
import { kill } from "../../src/tools/kill.js";
import { running } from "../../src/tools/running.js";
import { parseToolResult } from "../helpers.js";

describe("status tool", () => {
  it("returns records for known ids and an error marker for unknown ones", async () => {
    const job = jobStore.create({ tool: "run_bash_container", needsApproval: false, summary: "x" });
    const result = await status({ ids: [job.id, "unknown-id"] });
    const records = parseToolResult<Array<{ id: string; status?: string; error?: string }>>(result);
    expect(records[0]).toMatchObject({ id: job.id, status: "running" });
    expect(records[1]).toMatchObject({ id: "unknown-id", error: "unknown id" });
  });
});

describe("wait tool", () => {
  it("returns immediately if a given id is already terminal", async () => {
    const job = jobStore.create({ tool: "run_bash_container", needsApproval: false, summary: "x" });
    jobStore.finish(job.id, { exitCode: 0 });
    const start = Date.now();
    const result = await wait({ ids: [job.id], timeout: 5 });
    expect(Date.now() - start).toBeLessThan(500);
    const records = parseToolResult<Array<{ id: string; status: string }>>(result);
    expect(records[0].status).toBe("finished");
  });

  it("resolves as soon as any one of several ids finishes", async () => {
    const a = jobStore.create({ tool: "run_bash_host", needsApproval: true, reason: "r", summary: "a" });
    const b = jobStore.create({ tool: "run_bash_host", needsApproval: true, reason: "r", summary: "b" });
    // "running" isn't terminal — reject it instead so wait() actually has something to resolve on.
    setTimeout(() => jobStore.reject(a.id, "done testing"), 20);
    const result = await wait({ ids: [a.id, b.id], timeout: 5 });
    const records = parseToolResult<Array<{ id: string; status: string }>>(result);
    const aRecord = records.find((r) => r.id === a.id)!;
    const bRecord = records.find((r) => r.id === b.id)!;
    expect(aRecord.status).toBe("rejected");
    expect(bRecord.status).toBe("waiting-approval");
  });

  it("gives up after the timeout if nothing resolves", async () => {
    const job = jobStore.create({ tool: "run_bash_host", needsApproval: true, reason: "r", summary: "never" });
    const start = Date.now();
    const result = await wait({ ids: [job.id], timeout: 0.1 });
    expect(Date.now() - start).toBeGreaterThanOrEqual(90);
    const records = parseToolResult<Array<{ id: string; status: string }>>(result);
    expect(records[0].status).toBe("waiting-approval");
  });
});

describe("kill tool", () => {
  it("cancels a pending job and reports the rejection", async () => {
    const job = jobStore.create({ tool: "run_bash_host", needsApproval: true, reason: "r", summary: "x" });
    const result = await kill({ id: job.id });
    const outcome = parseToolResult<{ status: string; note: string }>(result);
    expect(outcome.status).toBe("rejected");
    expect(outcome.note).toBe("Killed via kill command before approval");
  });
});

describe("running tool", () => {
  it("lists only currently-running job ids", async () => {
    const a = jobStore.create({ tool: "run_bash_container", needsApproval: false, summary: "a" });
    jobStore.create({ tool: "run_bash_host", needsApproval: true, reason: "r", summary: "b" });
    const result = await running({});
    const ids = parseToolResult<string[]>(result);
    expect(ids).toContain(a.id);
  });
});
