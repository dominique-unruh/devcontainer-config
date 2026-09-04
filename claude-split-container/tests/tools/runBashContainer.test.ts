import { describe, it, expect, vi } from "vitest";
import type { ExecHandle, ExecResult } from "../../src/devcontainerExec.js";

vi.mock("../../src/devcontainerExec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/devcontainerExec.js")>();
  return {
    ...actual,
    // Foreground calls only read `.result`; live buffers are here for completeness.
    runBashContainer: vi.fn((command: string): ExecHandle => {
      const result: ExecResult = {
        exitCode: command.includes("fail") ? 1 : 0,
        stdout: command.includes("fail") ? "" : `ran: ${command}`,
        stderr: command.includes("fail") ? "boom" : "",
        timedOut: false,
        killed: false,
      };
      return {
        result: Promise.resolve(result),
        kill: vi.fn(),
        liveStdout: () => result.stdout,
        liveStderr: () => result.stderr,
      };
    }),
  };
});

const { runBashContainer } = await import("../../src/tools/runBashContainer.js");
const { toolText } = await import("../helpers.js");

describe("run_bash_container tool (foreground)", () => {
  it("requires no approval — runs immediately and returns the output inline", async () => {
    const out = toolText(await runBashContainer({ command: "echo hi" }));
    expect(out).toBe("ran: echo hi");
  });

  it("does not require a timeout (the built-in default applies)", async () => {
    await expect(runBashContainer({ command: "echo hi" })).resolves.toBeDefined();
  });

  it("appends an exit-code footer for a non-zero exit and includes stderr", async () => {
    const out = toolText(await runBashContainer({ command: "fail please" }));
    expect(out).toContain("boom");
    expect(out).toContain("Exit code: 1");
  });
});
