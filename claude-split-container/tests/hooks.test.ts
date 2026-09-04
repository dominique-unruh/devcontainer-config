import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HOOKS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "hooks");
const REMIND = join(HOOKS_DIR, "remind.mjs");
const GATE = join(HOOKS_DIR, "gate-bash.mjs");

/** Run the reminder hook with a given SPLIT_CONTAINER_ENFORCE value and return its stdout. */
function runRemind(mode?: string): string {
  const env = { ...process.env };
  if (mode === undefined) delete env.SPLIT_CONTAINER_ENFORCE;
  else env.SPLIT_CONTAINER_ENFORCE = mode;
  return execFileSync("node", [REMIND], { env, encoding: "utf8" });
}

/** Run the gate hook with a Bash tool_input.command on stdin; return its stdout. */
function runGate(command: string, mode?: string): string {
  const env = { ...process.env };
  if (mode === undefined) delete env.SPLIT_CONTAINER_ENFORCE;
  else env.SPLIT_CONTAINER_ENFORCE = mode;
  return execFileSync("node", [GATE], {
    env,
    encoding: "utf8",
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
  });
}

describe("SessionStart reminder hook", () => {
  // Regression guard: plain-text stdout is reported as a successful hook run by
  // Claude Code but is never injected into the model's context, so the reminder
  // silently does nothing. It must be JSON with additionalContext.
  it("emits JSON with hookSpecificOutput.additionalContext, not plain text", () => {
    const raw = runRemind();
    expect(raw.startsWith("{")).toBe(true);
    const out = JSON.parse(raw);
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(typeof out.hookSpecificOutput.additionalContext).toBe("string");
    expect(out.hookSpecificOutput.additionalContext.length).toBeGreaterThan(0);
  });

  it("steers to run_bash_container and documents the built-in Bash gate", () => {
    const ctx = JSON.parse(runRemind()).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("run_bash_container");
    expect(ctx).toMatch(/built-in Bash/);
    expect(ctx).toContain("# NOT IN CONTAINER");
  });

  it("no longer references the removed host/file MCP tools", () => {
    const ctx = JSON.parse(runRemind()).hookSpecificOutput.additionalContext;
    expect(ctx).not.toContain("run_bash_host");
    expect(ctx).not.toContain("read_file");
    expect(ctx).not.toContain("write_file");
    expect(ctx).not.toContain("patch_file");
  });

  it("emits nothing at all when disabled", () => {
    expect(runRemind("off")).toBe("");
  });
});

describe("gate-bash PreToolUse hook", () => {
  it("denies a plain command with routing guidance", () => {
    const out = JSON.parse(runGate("grep foo bar"));
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("run_bash_container");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("# NOT IN CONTAINER");
  });

  it("allows a command whose first line opts in with # NOT IN CONTAINER", () => {
    expect(runGate("# NOT IN CONTAINER: needs the host docker daemon\ndocker ps")).toBe("");
  });

  it("emits nothing (allows) when disabled", () => {
    expect(runGate("grep foo bar", "off")).toBe("");
  });
});
