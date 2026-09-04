import { describe, it, expect, beforeEach } from "vitest";
import { ShellStore } from "../src/shells.js";
import type { ExecHandle, ExecResult } from "../src/devcontainerExec.js";

/** A controllable fake ExecHandle: grow its live buffers, then settle its result on demand. */
function fakeHandle() {
  let stdout = "";
  let stderr = "";
  let resolveResult!: (r: ExecResult) => void;
  let killed = false;
  const result = new Promise<ExecResult>((r) => (resolveResult = r));
  const handle: ExecHandle = {
    result,
    kill: () => (killed = true),
    liveStdout: () => stdout,
    liveStderr: () => stderr,
  };
  return {
    handle,
    pushStdout: (s: string) => (stdout += s),
    pushStderr: (s: string) => (stderr += s),
    finish: (r: Partial<ExecResult> = {}) =>
      resolveResult({ exitCode: 0, stdout, stderr, timedOut: false, killed, ...r }),
    wasKilled: () => killed,
  };
}

describe("ShellStore", () => {
  let store: ShellStore;

  beforeEach(() => {
    store = new ShellStore();
  });

  it("assigns short consecutive ids starting at 1", () => {
    const a = store.register({ command: "a", handle: fakeHandle().handle });
    const b = store.register({ command: "b", handle: fakeHandle().handle });
    expect([a.id, b.id]).toEqual(["1", "2"]);
  });

  it("a freshly-registered shell is running", () => {
    const rec = store.register({ command: "sleep 1", handle: fakeHandle().handle });
    expect(rec.status).toBe("running");
    expect(store.runningIds()).toEqual([rec.id]);
  });

  it("readNew returns only output produced since the previous read", () => {
    const f = fakeHandle();
    const rec = store.register({ command: "x", handle: f.handle });

    f.pushStdout("line one\n");
    expect(store.readNew(rec.id)!.stdout).toBe("line one\n");

    // nothing new yet
    expect(store.readNew(rec.id)!.stdout).toBe("");

    f.pushStdout("line two\n");
    expect(store.readNew(rec.id)!.stdout).toBe("line two\n");
  });

  it("readNew reports stderr independently of stdout", () => {
    const f = fakeHandle();
    const rec = store.register({ command: "x", handle: f.handle });
    f.pushStdout("out\n");
    f.pushStderr("err\n");
    const out = store.readNew(rec.id)!;
    expect(out.stdout).toBe("out\n");
    expect(out.stderr).toBe("err\n");
  });

  it("filter keeps only matching lines but still advances the cursor past all output", () => {
    const f = fakeHandle();
    const rec = store.register({ command: "x", handle: f.handle });
    f.pushStdout("keep-me\ndrop\nkeep-you\n");
    const out = store.readNew(rec.id, "keep")!;
    expect(out.stdout).toBe("keep-me\nkeep-you");
    // cursor advanced past the dropped line too
    f.pushStdout("later\n");
    expect(store.readNew(rec.id, "keep")!.stdout).toBe("");
  });

  it("becomes completed with an exit code once the process exits", async () => {
    const f = fakeHandle();
    const rec = store.register({ command: "x", handle: f.handle });
    f.pushStdout("done\n");
    f.finish({ exitCode: 3 });
    await f.handle.result;
    expect(rec.status).toBe("completed");
    const out = store.readNew(rec.id)!;
    expect(out.status).toBe("completed");
    expect(out.exitCode).toBe(3);
  });

  it("kill signals the handle and the shell settles to killed", async () => {
    const f = fakeHandle();
    const rec = store.register({ command: "sleep 100", handle: f.handle });
    store.kill(rec.id);
    expect(f.wasKilled()).toBe(true);
    f.finish({ exitCode: null, killed: true });
    await f.handle.result;
    expect(rec.status).toBe("killed");
  });

  it("readNew returns undefined for an unknown id; kill throws", () => {
    expect(store.readNew("nope")).toBeUndefined();
    expect(() => store.kill("nope")).toThrow(/Unknown shell id/);
  });

  it("runningShells lists running shells newest-first and drops finished ones", async () => {
    const a = store.register({ command: "a", handle: fakeHandle().handle });
    const f = fakeHandle();
    const b = store.register({ command: "b", handle: f.handle });
    expect(store.runningShells().map((s) => s.id)).toEqual([b.id, a.id]);
    f.finish({ exitCode: 0 });
    await f.handle.result;
    expect(store.runningShells().map((s) => s.id)).toEqual([a.id]);
  });

  it("waitForTerminal returns at once for an already-terminal shell", async () => {
    const f = fakeHandle();
    const rec = store.register({ command: "x", handle: f.handle });
    f.finish({ exitCode: 0 });
    await f.handle.result;
    const start = Date.now();
    const got = await store.waitForTerminal(rec.id, 5000);
    expect(Date.now() - start).toBeLessThan(200);
    expect(got!.status).toBe("completed");
  });

  it("waitForTerminal resolves as soon as the shell finishes", async () => {
    const f = fakeHandle();
    const rec = store.register({ command: "x", handle: f.handle });
    setTimeout(() => f.finish({ exitCode: 2 }), 20);
    const got = await store.waitForTerminal(rec.id, 5000);
    expect(got!.status).toBe("completed");
    expect(got!.result!.exitCode).toBe(2);
  });

  it("waitForTerminal gives up after the timeout, leaving the shell running", async () => {
    const rec = store.register({ command: "x", handle: fakeHandle().handle });
    const start = Date.now();
    const got = await store.waitForTerminal(rec.id, 60);
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
    expect(got!.status).toBe("running");
  });

  it("waitForTerminal returns undefined for an unknown id", async () => {
    expect(await store.waitForTerminal("nope", 10)).toBeUndefined();
  });
});
