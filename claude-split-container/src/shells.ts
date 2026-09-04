import type { ExecHandle, ExecResult } from "./devcontainerExec.js";

export type ShellStatus = "running" | "completed" | "killed";

/** Max characters returned from a single `bash_output` read, mirroring the built-in BashOutput cap. */
const MAX_OUTPUT_CHARS = 30_000;

function truncate(s: string): string {
  if (s.length <= MAX_OUTPUT_CHARS) return s;
  const cut = s.length - MAX_OUTPUT_CHARS;
  return `${s.slice(s.length - MAX_OUTPUT_CHARS)}\n\n[...truncated ${cut} earlier characters...]`;
}

/** Keep only the lines of `text` matching `pattern` (a JS regex source). Cursor bookkeeping is unaffected — this only shapes what a read returns. */
function filterLines(text: string, pattern: RegExp): string {
  return text
    .split("\n")
    .filter((line) => pattern.test(line))
    .join("\n");
}

export interface ShellRecord {
  id: string;
  command: string;
  description?: string;
  status: ShellStatus;
  handle: ExecHandle;
  /** Final result, set once the underlying process exits. */
  result?: ExecResult;
  /** How much of the live stdout/stderr buffers has already been handed out by `readNew`. */
  stdoutCursor: number;
  stderrCursor: number;
}

/** One incremental read of a background shell's output — only what's new since the previous read. */
export interface ShellOutput {
  status: ShellStatus;
  exitCode?: number | null;
  timedOut: boolean;
  killed: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Registry of background shells started via `run_bash_container` with `run_in_background`. Mirrors the
 * built-in Bash/BashOutput/KillShell model: a shell gets a short id, its output is read incrementally
 * (only what's new since last read), and it can be killed by id. Foreground commands don't live here —
 * they block and return their output inline, no id needed.
 */
export class ShellStore {
  private shells = new Map<string, ShellRecord>();
  /** Source of consecutive shell ids ("1", "2", …) — short enough to read out and type by hand. */
  private nextId = 1;

  /** Record a freshly-started background command and wire its terminal status to the process result. */
  register(params: { command: string; description?: string; handle: ExecHandle }): ShellRecord {
    const id = String(this.nextId++);
    const rec: ShellRecord = {
      id,
      command: params.command,
      description: params.description,
      status: "running",
      handle: params.handle,
      stdoutCursor: 0,
      stderrCursor: 0,
    };
    this.shells.set(id, rec);
    void params.handle.result.then((r) => {
      rec.result = r;
      rec.status = r.killed ? "killed" : "completed";
    });
    return rec;
  }

  /** Look up a shell by id, or undefined if it doesn't exist. */
  get(id: string): ShellRecord | undefined {
    return this.shells.get(id);
  }

  /** All shell records, in no particular order. */
  list(): ShellRecord[] {
    return [...this.shells.values()];
  }

  /**
   * Read the output a shell has produced since the last `readNew` for that id: advance its cursors past
   * the current live buffers and return the slice in between, optionally filtered to lines matching
   * `filter` (the cursor still advances past all of it, matched or not). Undefined for an unknown id.
   */
  readNew(id: string, filter?: string): ShellOutput | undefined {
    const rec = this.shells.get(id);
    if (!rec) return undefined;

    const fullOut = rec.handle.liveStdout();
    const fullErr = rec.handle.liveStderr();
    let newOut = fullOut.slice(rec.stdoutCursor);
    let newErr = fullErr.slice(rec.stderrCursor);
    rec.stdoutCursor = fullOut.length;
    rec.stderrCursor = fullErr.length;

    if (filter) {
      const re = new RegExp(filter);
      newOut = filterLines(newOut, re);
      newErr = filterLines(newErr, re);
    }

    return {
      status: rec.status,
      exitCode: rec.result?.exitCode,
      timedOut: rec.result?.timedOut ?? false,
      killed: rec.result?.killed ?? false,
      stdout: truncate(newOut),
      stderr: truncate(newErr),
    };
  }

  /** Send a kill signal to a running shell (no-op if already terminal). Its status flips to `killed` once the process actually exits. */
  kill(id: string): ShellRecord {
    const rec = this.mustGet(id);
    if (rec.status === "running") rec.handle.kill();
    return rec;
  }

  /** Ids of every shell still running. */
  runningIds(): string[] {
    return this.runningShells().map((s) => s.id);
  }

  /** Every shell still running, newest first. */
  runningShells(): ShellRecord[] {
    return this.list()
      .filter((s) => s.status === "running")
      .sort((a, b) => Number(b.id) - Number(a.id));
  }

  /**
   * Block until a shell reaches a terminal state, or `timeoutMs` elapses, then return its record
   * (status still `running` if the wait timed out). Undefined for an unknown id. A shell that's already
   * terminal returns at once.
   */
  async waitForTerminal(id: string, timeoutMs: number): Promise<ShellRecord | undefined> {
    const rec = this.shells.get(id);
    if (!rec || rec.status !== "running") return rec;
    await Promise.race([
      rec.handle.result.catch(() => {}),
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, timeoutMs);
        t.unref?.();
      }),
    ]);
    // register()'s own result handler, subscribed at registration time, runs before this continuation,
    // so rec.status is already up to date by the time we return.
    return rec;
  }

  /** Like `get`, but throws for an unknown id instead of returning undefined. */
  private mustGet(id: string): ShellRecord {
    const rec = this.shells.get(id);
    if (!rec) throw new Error(`Unknown shell id ${id}`);
    return rec;
  }
}

export const shellStore = new ShellStore();
