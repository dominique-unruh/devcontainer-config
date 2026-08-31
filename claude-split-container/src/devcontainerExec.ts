import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

/**
 * Default config for projects that ship no devcontainer config of their own: a static file bundled
 * with the plugin, resolved relative to this server file so it works both under `tsx` (from `src/`)
 * and as the bundled `dist/server.js` — both are siblings of `assets/` under the plugin root.
 */
const DEFAULT_CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "default-devcontainer.json");

/** Whether the project supplies its own devcontainer config (in either of the two spec locations). */
function hasProjectConfig(): boolean {
  return (
    existsSync(join(PROJECT_DIR, ".devcontainer", "devcontainer.json")) ||
    existsSync(join(PROJECT_DIR, ".devcontainer.json"))
  );
}

/**
 * devcontainer CLI args selecting the config to use: none (let the CLI auto-discover) if the project
 * ships its own config, otherwise `--override-config` pointing at the bundled default. The same args
 * must be passed to both `up` and `exec` so they agree on which container this is.
 */
function configArgs(): string[] {
  return hasProjectConfig() ? [] : ["--override-config", DEFAULT_CONFIG_PATH];
}

/** Bring the project's devcontainer up (`devcontainer up`) — idempotent, a no-op build if it's already running. */
function devcontainerUp(cfgArgs: string[], timeoutMs?: number): ExecHandle {
  return runProcess("devcontainer", ["up", "--workspace-folder", PROJECT_DIR, ...cfgArgs], {
    cwd: PROJECT_DIR,
    timeoutMs,
  });
}

/** Run the actual command inside the (assumed-running) devcontainer via `devcontainer exec`. */
function devcontainerExec(cfgArgs: string[], command: string, timeoutMs?: number): ExecHandle {
  return runProcess(
    "devcontainer",
    ["exec", "--workspace-folder", PROJECT_DIR, ...cfgArgs, "--", "bash", "-e", "-c", command],
    { cwd: PROJECT_DIR, timeoutMs }
  );
}

/**
 * Run a bash command inside the project's devcontainer. Starts the container first if it isn't up
 * yet (`devcontainer exec` fails outright against a stopped container), so callers don't have to
 * bring it up manually. Projects without their own devcontainer config get a minimal bundled default
 * (`ubuntu:24.04`). The startup is done once per process and cached; if it fails, the failure is
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
    const cfgArgs = configArgs();
    if (!containerUp) {
      active = devcontainerUp(cfgArgs, timeoutMs);
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
    active = devcontainerExec(cfgArgs, command, timeoutMs);
    return active.result;
  })();

  return { result, kill };
}
