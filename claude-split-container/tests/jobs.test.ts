import { describe, it, expect, beforeEach } from "vitest";
import { JobStore } from "../src/jobs.js";

describe("JobStore", () => {
  let store: JobStore;

  beforeEach(() => {
    store = new JobStore();
  });

  it("assigns short consecutive ids starting at 1", () => {
    const a = store.create({ tool: "run_bash_container", summary: "a" });
    const b = store.create({ tool: "run_bash_container", summary: "b" });
    const c = store.create({ tool: "run_bash_container", summary: "c" });
    expect([a.id, b.id, c.id]).toEqual(["1", "2", "3"]);
  });

  it("a job with no deps goes straight to running", () => {
    const job = store.create({ tool: "run_bash_container", summary: "echo hi" });
    expect(job.status).toBe("running");
    expect(job.startedAt).toBeDefined();
  });

  it("a job with an unfinished dependency starts in waiting-dependencies", () => {
    const dep = store.create({ tool: "run_bash_container", summary: "sleep 1" }); // instantly running, not finished
    const job = store.create({ tool: "run_bash_container", summary: "echo hi", after: [dep.id] });
    expect(dep.status).toBe("running");
    expect(job.status).toBe("waiting-dependencies");
  });

  it("a successful dependency unblocks a waiting-dependencies job into running", () => {
    const dep = store.create({ tool: "run_bash_container", summary: "x" });
    const job = store.create({ tool: "run_bash_container", summary: "y", after: [dep.id] });
    expect(job.status).toBe("waiting-dependencies");
    store.finish(dep.id, { exitCode: 0 });
    expect(job.status).toBe("running");
  });

  it("rejecting a job records the note and status", () => {
    const job = store.create({ tool: "run_bash_container", summary: "x" });
    store.reject(job.id, "no thanks");
    expect(job.status).toBe("rejected");
    expect(job.note).toBe("no thanks");
  });

  it("cascades rejection to dependents with a note naming the rejected id", () => {
    const dep = store.create({ tool: "run_bash_container", summary: "x" });
    const job = store.create({ tool: "run_bash_container", summary: "y", after: [dep.id] });
    store.reject(dep.id, "nope");
    expect(job.status).toBe("rejected");
    expect(job.note).toBe(`Command ${dep.id} was rejected`);
  });

  it("cascades rejection transitively through a chain", () => {
    const a = store.create({ tool: "run_bash_container", summary: "a" });
    const b = store.create({ tool: "run_bash_container", summary: "b", after: [a.id] });
    const c = store.create({ tool: "run_bash_container", summary: "c", after: [b.id] });
    store.reject(a.id, "nope");
    expect(b.status).toBe("rejected");
    expect(c.status).toBe("rejected");
  });

  it("a dependency that finishes with a non-zero exit code cascade-rejects dependents with a failure note", () => {
    const dep = store.create({ tool: "run_bash_container", summary: "false" });
    const job = store.create({ tool: "run_bash_container", summary: "echo after", after: [dep.id] });
    expect(dep.status).toBe("running");
    store.finish(dep.id, { exitCode: 3 });
    expect(job.status).toBe("rejected");
    expect(job.note).toBe(`Command ${dep.id} failed (exit code 3)`);
  });

  it("a dependency that finishes with an error field cascade-rejects with an error-based note", () => {
    const dep = store.create({ tool: "run_bash_container", summary: "x" });
    const job = store.create({ tool: "run_bash_container", summary: "y", after: [dep.id] });
    store.finish(dep.id, { error: "boom" });
    expect(job.status).toBe("rejected");
    expect(job.note).toBe(`Command ${dep.id} failed: boom`);
  });

  it("kill on a waiting-dependencies job rejects it with a before-dependencies note", () => {
    const dep = store.create({ tool: "run_bash_container", summary: "x" });
    const job = store.create({ tool: "run_bash_container", summary: "y", after: [dep.id] });
    expect(job.status).toBe("waiting-dependencies");
    store.kill(job.id);
    expect(job.status).toBe("rejected");
    expect(job.note).toBe("Killed via kill command before dependencies finished");
  });

  it("kill on a running job invokes the registered onKill handler without immediately finishing it", () => {
    const job = store.create({ tool: "run_bash_container", summary: "sleep 100" });
    let killed = false;
    store.setOnKill(job.id, () => (killed = true));
    store.kill(job.id);
    expect(killed).toBe(true);
    expect(job.status).toBe("running");
    store.finish(job.id, { exitCode: null, killed: true });
    expect(job.status).toBe("finished");
  });

  it("kill on a running job with no registered handler throws", () => {
    const job = store.create({ tool: "run_bash_container", summary: "sleep 100" });
    expect(() => store.kill(job.id)).toThrow(/no kill handler/);
  });

  it("kill on an already-terminal job throws", () => {
    const job = store.create({ tool: "run_bash_container", summary: "echo hi" });
    store.finish(job.id, { exitCode: 0 });
    expect(() => store.kill(job.id)).toThrow(/already terminal/);
  });

  it("reject on an already-terminal job throws", () => {
    const job = store.create({ tool: "run_bash_container", summary: "echo hi" });
    store.finish(job.id, { exitCode: 0 });
    expect(() => store.reject(job.id, "x")).toThrow(/already terminal/);
  });

  it("runningIds() lists exactly the jobs currently running", () => {
    const a = store.create({ tool: "run_bash_container", summary: "a" });
    const b = store.create({ tool: "run_bash_container", summary: "b", after: [a.id] });
    expect(store.runningIds().sort()).toEqual([a.id].sort());
    expect(b.status).toBe("waiting-dependencies");
    store.finish(a.id, { exitCode: 0 });
    expect(store.runningIds().sort()).toEqual([b.id].sort());
  });

  it("waitUntilRunningOrTerminal resolves immediately for an already-running job", async () => {
    const job = store.create({ tool: "run_bash_container", summary: "x" });
    const resolved = await store.waitUntilRunningOrTerminal(job.id);
    expect(resolved.status).toBe("running");
  });

  it("waitUntilRunningOrTerminal resolves once a dependency finishes", async () => {
    const dep = store.create({ tool: "run_bash_container", summary: "dep" });
    const job = store.create({ tool: "run_bash_container", summary: "job", after: [dep.id] });
    const promise = store.waitUntilRunningOrTerminal(job.id);
    store.finish(dep.id, { exitCode: 0 });
    const resolved = await promise;
    expect(resolved.status).toBe("running");
  });

  it("waitUntilRunningOrTerminal resolves with rejected if the job is rejected before it can start", async () => {
    const dep = store.create({ tool: "run_bash_container", summary: "dep" });
    const job = store.create({ tool: "run_bash_container", summary: "job", after: [dep.id] });
    const promise = store.waitUntilRunningOrTerminal(job.id);
    store.reject(job.id, "no");
    const resolved = await promise;
    expect(resolved.status).toBe("rejected");
  });

  it("emits a 'change' event on create/reject/finish", () => {
    const events: string[] = [];
    store.events.on("change", () => events.push("change"));
    const job = store.create({ tool: "run_bash_container", summary: "x" });
    store.finish(job.id, { exitCode: 0 });
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it("unknown after-ids are treated as already satisfied", () => {
    const job = store.create({ tool: "run_bash_container", summary: "x", after: ["not-a-real-id"] });
    expect(job.status).toBe("running");
  });

  it("get() returns undefined for an unknown id, mutating methods throw", () => {
    expect(store.get("nope")).toBeUndefined();
    expect(() => store.reject("nope", undefined)).toThrow(/Unknown job id/);
    expect(() => store.finish("nope", {})).toThrow(/Unknown job id/);
    expect(() => store.kill("nope")).toThrow(/Unknown job id/);
  });
});
