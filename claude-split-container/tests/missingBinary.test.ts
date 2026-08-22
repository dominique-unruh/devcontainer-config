import { describe, it, expect } from "vitest";
import { runBashContainer } from "../src/devcontainerExec.js";

describe("missing binaries", () => {
  // Regression guard: an unhandled 'error' event from spawn used to take down the whole MCP
  // server ("connection closed"), rather than failing the single command that caused it.
  it("a missing executable resolves as a failed command instead of crashing", async () => {
    const handle = runBashContainer("whoami");
    const result = await handle.result;
    // `devcontainer` may or may not be installed wherever the tests run; either way the promise
    // must resolve rather than throwing, and a missing binary must be reported as a failure.
    expect(result).toBeDefined();
    if (result.exitCode === null) {
      expect(result.stderr).toMatch(/could not run `devcontainer`/);
    }
  });

  it("kill() on a process that never started does not throw", () => {
    const handle = runBashContainer("whoami");
    expect(() => handle.kill()).not.toThrow();
  });
});
