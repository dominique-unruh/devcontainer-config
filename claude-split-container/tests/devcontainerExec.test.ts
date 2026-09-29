import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configArgs, runBashHost } from "../src/devcontainerExec.js";
import { PROJECT_DIR } from "../src/sharedDir.js";

describe("configArgs", () => {
  const projectConfigDir = join(PROJECT_DIR, ".devcontainer");

  afterEach(() => rmSync(projectConfigDir, { recursive: true, force: true }));

  it("passes no config args when the project ships its own devcontainer.json", () => {
    mkdirSync(projectConfigDir, { recursive: true });
    writeFileSync(join(projectConfigDir, "devcontainer.json"), "{}");
    expect(configArgs()).toEqual([]);
  });

  it("otherwise stages the bundled default outside the project and passes it via --config", () => {
    const args = configArgs();
    expect(args[0]).toBe("--config");
    const staged = args[1];
    expect(staged.startsWith(process.env.XDG_CACHE_HOME!)).toBe(true);
    const bundled = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "default-devcontainer.json");
    expect(readFileSync(staged, "utf8")).toBe(readFileSync(bundled, "utf8"));
    // Nothing gets created in the project (the CLI would write its lockfile there under --override-config).
    expect(existsSync(projectConfigDir)).toBe(false);
  });
});

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
