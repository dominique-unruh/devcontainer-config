import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", "hooks", "remind.mjs");

/** Run the reminder hook with a given SPLIT_CONTAINER_ENFORCE value and return its stdout. */
function runHook(mode?: string): string {
  const env = { ...process.env };
  if (mode === undefined) delete env.SPLIT_CONTAINER_ENFORCE;
  else env.SPLIT_CONTAINER_ENFORCE = mode;
  return execFileSync("node", [HOOK], { env, encoding: "utf8" });
}

function parsed(mode?: string) {
  return JSON.parse(runHook(mode)) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string };
  };
}

describe("UserPromptSubmit reminder hook", () => {
  // Regression guard: plain-text stdout is reported as a successful hook run by
  // Claude Code but is never injected into the model's context, so the reminder
  // silently does nothing. It must be JSON with additionalContext.
  it("emits JSON with hookSpecificOutput.additionalContext, not plain text", () => {
    const raw = runHook();
    expect(raw.startsWith("{")).toBe(true);
    const out = JSON.parse(raw);
    expect(out.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(typeof out.hookSpecificOutput.additionalContext).toBe("string");
    expect(out.hookSpecificOutput.additionalContext.length).toBeGreaterThan(0);
  });

  it("names the MCP tools to use instead of built-in Bash", () => {
    const ctx = parsed().hookSpecificOutput.additionalContext;
    expect(ctx).toContain("run_bash_container");
    expect(ctx).toContain("run_bash_host");
    expect(ctx).toMatch(/built-in Bash/);
  });

  it("explains the project-dir vs host-file split in the default mode", () => {
    const ctx = parsed("all").hookSpecificOutput.additionalContext;
    expect(ctx).toContain("project dir");
    expect(ctx).toContain("read_file/write_file/patch_file");
  });

  it("omits file-tool guidance in bash mode", () => {
    const ctx = parsed("bash").hookSpecificOutput.additionalContext;
    expect(ctx).toContain("run_bash_container");
    expect(ctx).not.toContain("read_file/write_file/patch_file");
  });

  it("emits nothing at all when disabled", () => {
    expect(runHook("off")).toBe("");
  });

  it("treats an unrecognised value like the default mode", () => {
    expect(parsed("something-else").hookSpecificOutput.additionalContext).toContain(
      "read_file/write_file/patch_file"
    );
  });
});
