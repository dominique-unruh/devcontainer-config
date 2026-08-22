import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/devcontainerExec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/devcontainerExec.js")>();
  return {
    ...actual,
    runBashContainer: vi.fn((command: string, timeoutMs?: number) => ({
      result: Promise.resolve({
        exitCode: command.includes("fail") ? 1 : 0,
        stdout: `ran: ${command}`,
        stderr: "",
        timedOut: false,
        killed: false,
      }),
      kill: vi.fn(),
    })),
  };
});

const { runBashContainer } = await import("../../src/tools/runBashContainer.js");
const { parseToolResult } = await import("../helpers.js");

describe("run_bash_container tool", () => {
  it("throws if timeout is missing in the foreground", async () => {
    await expect(runBashContainer({ command: "echo hi" } as never)).rejects.toThrow(/timeout is mandatory/);
  });

  it("requires no approval — runs immediately in the foreground and returns inline output", async () => {
    const result = await runBashContainer({ command: "echo hi", timeout: 5 });
    const outcome = parseToolResult<{ background: boolean; status: string; result: { exitCode: number; stdout: string } }>(
      result
    );
    expect(outcome.background).toBe(false);
    expect(outcome.status).toBe("finished");
    expect(outcome.result.exitCode).toBe(0);
    expect(outcome.result.stdout).toBe("ran: echo hi");
  });

  it("reflects a non-zero exit code", async () => {
    const result = await runBashContainer({ command: "fail please", timeout: 5 });
    const outcome = parseToolResult<{ result: { exitCode: number } }>(result);
    expect(outcome.result.exitCode).toBe(1);
  });
});
