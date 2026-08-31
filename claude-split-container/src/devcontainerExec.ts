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
    let settled = false;
    const settle = (r: ExecResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolveP(r);
    };

    // Without this, a missing binary (no `devcontainer` on PATH, say) emits an unhandled 'error'
    // event, which crashes the whole MCP server instead of failing the one command.
    child.on("error", (err) => {
      settle({
        exitCode: null,
        stdout: truncate(stdout),
        stderr: `${stderr}${stderr ? "\n" : ""}could not run \`${cmd}\`: ${err.message}`,
        timedOut,
        killed: killedByUs,
      });
    });

    child.on("close", (code) => {
      settle({
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

/**
 * Whether we've already brought the devcontainer up in this process. `devcontainer up` is
 * idempotent but slow, so we only run it until it succeeds once, then reuse the running container.
 */
let containerUp = false;

/** Bring the project's devcontainer up (`devcontainer up`) — idempotent, a no-op build if it's already running. */
function devcontainerUp(timeoutMs?: number): ExecHandle {
  return runProcess("devcontainer", ["up", "--workspace-folder", PROJECT_DIR], {
    cwd: PROJECT_DIR,
    timeoutMs,
  });
}

/** Run the actual command inside the (assumed-running) devcontainer via `devcontainer exec`. */
function devcontainerExec(command: string, timeoutMs?: number): ExecHandle {
  return runProcess(
    "devcontainer",
    ["exec", "--workspace-folder", PROJECT_DIR, "--", "bash", "-e", "-c", command],
    { cwd: PROJECT_DIR, timeoutMs }
  );
}

/**
 * Run a bash command inside the project's devcontainer. Starts the container first if it isn't up
 * yet (`devcontainer exec` fails outright against a stopped container), so callers don't have to
 * bring it up manually. The startup is done once per process and cached; if it fails, the failure is
 * surfaced and retried on the next call.
 */
export function runBashContainer(command: string, timeoutMs?: number): ExecHandle {
  let active: ExecHandle | undefined;
  let killed = false;

  const kill = () => {
    killed = true;
    active?.kill();
  };

  const result = (async (): Promise<ExecResult> => {
    if (!containerUp) {
      active = devcontainerUp(timeoutMs);
      const up = await active.result;
      if (killed) return up;
      if (up.exitCode !== 0) {
        return {
          ...up,
          stderr: `${up.stderr}${up.stderr ? "\n" : ""}could not start the devcontainer (\`devcontainer up\`); command not run`,
        };
      }
      containerUp = true;
    }
    if (killed) {
      return { exitCode: null, stdout: "", stderr: "killed before start", timedOut: false, killed: true };
    }
    active = devcontainerExec(command, timeoutMs);
    return active.result;
  })();

  return { result, kill };
}
