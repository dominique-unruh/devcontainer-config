import { describe, it, expect, vi } from "vitest";
import type { ExecHandle, ExecResult } from "../../src/devcontainerExec.js";

// A registry of controllable fake handles, one per background run_bash_container call, so the tests can
// grow a shell's output and settle its exit status on demand.
const ctl = vi.hoisted(() => {
  interface Controller {
    push: (s: string) => void;
    finish: (r?: Partial<ExecResult>) => void;
    wasKilled: () => boolean;
  }
  return { handles: [] as Controller[] };
});

vi.mock("../../src/devcontainerExec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/devcontainerExec.js")>();
  return {
    ...actual,
    runBashContainer: vi.fn((): ExecHandle => {
      let stdout = "";
      let stderr = "";
      let killed = false;
      let resolveResult!: (r: ExecResult) => void;
      const result = new Promise<ExecResult>((r) => (resolveResult = r));
      ctl.handles.push({
        push: (s: string) => (stdout += s),
        finish: (r: Partial<ExecResult> = {}) =>
          resolveResult({ exitCode: 0, stdout, stderr, timedOut: false, killed, ...r }),
        wasKilled: () => killed,
      });
      return { result, kill: () => (killed = true), liveStdout: () => stdout, liveStderr: () => stderr };
    }),
  };
});

const { runBashContainer } = await import("../../src/tools/runBashContainer.js");
const { bashOutput } = await import("../../src/tools/bashOutput.js");
const { killShell } = await import("../../src/tools/killShell.js");
const { wait } = await import("../../src/tools/wait.js");
const { listBackgroundRunning } = await import("../../src/tools/listBackgroundRunning.js");
const { toolText } = await import("../helpers.js");

/** Start a background shell and return its id plus the controller for its fake handle. */
async function startBackground() {
  const text = toolText(await runBashContainer({ command: "long-running", run_in_background: true }));
  const id = text.match(/shell ID: (\d+)/)![1];
  return { id, ctl: ctl.handles[ctl.handles.length - 1] };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

describe("background shell lifecycle across run_bash_container / bash_output / kill_shell", () => {
  it("run_in_background returns a shell id immediately", async () => {
    const text = toolText(await runBashContainer({ command: "x", run_in_background: true }));
    expect(text).toMatch(/shell ID: \d+/);
  });

  it("bash_output streams only new output and reports completion + exit code", async () => {
    const { id, ctl: c } = await startBackground();

    expect(toolText(await bashOutput({ bash_id: id }))).toContain("<status>running</status>");

    c.push("hello\n");
    expect(toolText(await bashOutput({ bash_id: id }))).toContain("hello");
    // second read: nothing new
    expect(toolText(await bashOutput({ bash_id: id }))).toContain("<stdout>\n\n</stdout>");

    c.finish({ exitCode: 0 });
    await tick();
    const done = toolText(await bashOutput({ bash_id: id }));
    expect(done).toContain("<status>completed</status>");
    expect(done).toContain("<exit_code>0</exit_code>");
  });

  it("bash_output filter keeps only matching lines", async () => {
    const { id, ctl: c } = await startBackground();
    c.push("keep-me\ndrop-this\nkeep-you\n");
    const out = toolText(await bashOutput({ bash_id: id, filter: "keep" }));
    expect(out).toContain("keep-me");
    expect(out).toContain("keep-you");
    expect(out).not.toContain("drop-this");
  });

  it("kill_shell signals the shell and it settles to killed", async () => {
    const { id, ctl: c } = await startBackground();
    expect(toolText(await killShell({ shell_id: id }))).toContain("Sent kill signal");
    expect(c.wasKilled()).toBe(true);
    c.finish({ exitCode: null, killed: true });
    await tick();
    expect(toolText(await bashOutput({ bash_id: id }))).toContain("<status>killed</status>");
  });

  it("wait blocks until the shell finishes, then reports status and exit code", async () => {
    const { id, ctl: c } = await startBackground();
    setTimeout(() => c.finish({ exitCode: 5 }), 20);
    const out = toolText(await wait({ bash_id: id, timeout: 5000 }));
    expect(out).toContain("<status>completed</status>");
    expect(out).toContain("<exit_code>5</exit_code>");
  });

  it("wait reports a still-running shell when it times out", async () => {
    const { id } = await startBackground();
    const out = toolText(await wait({ bash_id: id, timeout: 30 }));
    expect(out).toContain("still running");
    expect(out).toContain("<status>running</status>");
  });

  it("list_background_running lists running shells and drops finished ones", async () => {
    const { id, ctl: c } = await startBackground();
    expect(toolText(await listBackgroundRunning({}))).toContain(`${id}:`);
    c.finish({ exitCode: 0 });
    await tick();
    expect(toolText(await listBackgroundRunning({}))).not.toContain(`${id}:`);
  });

  it("unknown ids are reported, not thrown", async () => {
    expect(toolText(await bashOutput({ bash_id: "no-such" }))).toContain("No background shell");
    expect(toolText(await killShell({ shell_id: "no-such" }))).toContain("No background shell");
    expect(toolText(await wait({ bash_id: "no-such", timeout: 10 }))).toContain("No background shell");
  });
});
