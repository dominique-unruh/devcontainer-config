import { describe, it, expect } from "vitest";
import { runBashHost } from "../src/devcontainerExec.js";

describe("runBashHost", () => {
  it("captures stdout, stderr, and a zero exit code", async () => {
    const handle = runBashHost("echo out-text; echo err-text 1>&2");
    const result = await handle.result;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("out-text\n");
    expect(result.stderr).toBe("err-text\n");
    expect(result.timedOut).toBe(false);
    expect(result.killed).toBe(false);
  });

  it("reports a non-zero exit code", async () => {
    const handle = runBashHost("exit 7");
    const result = await handle.result;
    expect(result.exitCode).toBe(7);
  });

  it("runs multiline scripts with bash -e semantics (stops at the first failing command)", async () => {
    const handle = runBashHost("echo one\nfalse\necho two");
    const result = await handle.result;
    expect(result.stdout).toBe("one\n");
    expect(result.exitCode).not.toBe(0);
  });

  it("truncates very long output", async () => {
    const handle = runBashHost("head -c 50000 /dev/zero | tr '\\0' 'a'");
    const result = await handle.result;
    expect(result.stdout.length).toBeLessThan(50000);
    expect(result.stdout).toContain("truncated");
  });

  it("times out and kills the process when it runs past the timeout", async () => {
    const handle = runBashHost("sleep 5", 100);
    const result = await handle.result;
    expect(result.timedOut).toBe(true);
    expect(result.killed).toBe(true);
    expect(result.exitCode).not.toBe(0);
  }, 10000);

  it("kill() aborts a still-running process early", async () => {
    const handle = runBashHost("sleep 5");
    setTimeout(() => handle.kill(), 50);
    const result = await handle.result;
    expect(result.killed).toBe(true);
    expect(result.exitCode).not.toBe(0);
  }, 10000);
});
