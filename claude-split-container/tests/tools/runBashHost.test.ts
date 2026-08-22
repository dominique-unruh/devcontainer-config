import { describe, it, expect } from "vitest";
import { runBashHost } from "../../src/tools/runBashHost.js";
import { jobStore } from "../../src/jobs.js";
import { waitForJobStatus, parseToolResult } from "../helpers.js";

describe("run_bash_host tool", () => {
  it("throws if timeout is missing in the foreground", async () => {
    await expect(runBashHost({ command: "echo hi", reason: "why" } as never)).rejects.toThrow(/timeout is mandatory/);
  });

  it("background:true returns an id before approval, then runs after approval and writes stdout/stderr files", async () => {
    const result = await runBashHost({
      command: "echo out-text; echo err-text 1>&2",
      reason: "why",
      background: true,
      timeout: 5,
    });
    const outcome = parseToolResult<{ id: string; background: boolean }>(result);
    expect(outcome.background).toBe(true);

    const job = jobStore.get(outcome.id)!;
    expect(job.status).toBe("waiting-approval");
    jobStore.approve(outcome.id);

    const finished = await waitForJobStatus(outcome.id, ["finished", "rejected"]);
    expect(finished!.status).toBe("finished");
    const finalResult = finished!.result as {
      exitCode: number;
      stdoutFile: { name: string; bytes: number };
      stderrFile: { name: string; bytes: number };
    };
    expect(finalResult.exitCode).toBe(0);
    expect(finalResult.stdoutFile.bytes).toBe(Buffer.byteLength("out-text\n"));
    expect(finalResult.stderrFile.bytes).toBe(Buffer.byteLength("err-text\n"));
  });

  it("a rejected approval never runs the command", async () => {
    const result = await runBashHost({
      command: "echo should-not-run",
      reason: "why",
      background: true,
      timeout: 5,
    });
    const outcome = parseToolResult<{ id: string }>(result);
    jobStore.reject(outcome.id, "not now");
    const job = await waitForJobStatus(outcome.id, ["rejected"]);
    expect(job!.note).toBe("not now");
  });
});
