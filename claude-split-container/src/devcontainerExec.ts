import { spawn } from "node:child_process";
import { PROJECT_DIR } from "./sharedDir.js";

export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  killed: boolean;
}

export interface ExecHandle {
  result: Promise<ExecResult>;
  kill: () => void;
}

const MAX_OUTPUT_CHARS = 30_000;

/** Truncate long process output the same way Claude Code's built-in Bash tool does, so huge output doesn't blow up the response. */
function truncate(s: string): string {
  if (s.length <= MAX_OUTPUT_CHARS) return s;
  const cut = s.length - MAX_OUTPUT_CHARS;
  return `${s.slice(0, MAX_OUTPUT_CHARS)}\n\n[...truncated ${cut} characters...]`;
}

/** Spawn a process, collect its stdout/stderr, and enforce an optional timeout (SIGTERM then SIGKILL). Returns immediately with a handle whose `result` resolves on exit and whose `kill()` aborts it early. */
function runProcess(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs?: number }
): ExecHandle {
  const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let killedByUs = false;
  let timer: NodeJS.Timeout | undefined;

  child.stdout.on("data", (d) => (stdout += d.toString()));
  child.stderr.on("data", (d) => (stderr += d.toString()));

  const killNow = () => {
    killedByUs = true;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, 5000).unref();
  };

  if (opts.timeoutMs !== undefined) {
    timer = setTimeout(() => {
      timedOut = true;
      killNow();
    }, opts.timeoutMs);
    timer.unref();
  }

  const result = new Promise<ExecResult>((resolveP) => {
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolveP({
        exitCode: code,
        stdout: truncate(stdout),
        stderr: truncate(stderr),
        timedOut,
        killed: killedByUs,
      });
    });
  });

  return { result, kill: killNow };
}

/** Run a bash command on the host, `bash -e -c`, cwd = project dir. */
export function runBashHost(command: string, timeoutMs?: number): ExecHandle {
  return runProcess("bash", ["-e", "-c", command], { cwd: PROJECT_DIR, timeoutMs });
}

/** Run a bash command inside the project's devcontainer via `devcontainer exec`. */
export function runBashContainer(command: string, timeoutMs?: number): ExecHandle {
  return runProcess(
    "devcontainer",
    ["exec", "--workspace-folder", PROJECT_DIR, "--", "bash", "-e", "-c", command],
    { cwd: PROJECT_DIR, timeoutMs }
  );
}
