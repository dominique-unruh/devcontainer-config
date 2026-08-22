import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { JobStore } from "../src/jobs.js";
import { startDashboardServer, type DashboardHandle } from "../src/ui/dashboardServer.js";

describe("dashboard server", () => {
  let store: JobStore;
  let dashboard: DashboardHandle;
  let base: string;
  let key: string;

  beforeEach(async () => {
    store = new JobStore();
    dashboard = await startDashboardServer(store);
    key = dashboard.key;
    base = dashboard.url.split("/?")[0];
  });

  afterEach(async () => {
    await dashboard.close();
  });

  it("rejects requests with a missing or wrong auth key", async () => {
    const noKey = await fetch(`${base}/api/commands`);
    expect(noKey.status).toBe(401);
    const wrongKey = await fetch(`${base}/api/commands`, { headers: { "x-auth-key": "wrong" } });
    expect(wrongKey.status).toBe(401);
  });

  it("serves the dashboard page at / when the key matches (via query param)", async () => {
    const res = await fetch(`${base}/?key=${key}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("claude-split-container");
  });

  it("lists jobs via GET /api/commands (header auth)", async () => {
    const job = store.create({ tool: "run_bash_host", needsApproval: true, reason: "why", summary: "echo hi" });
    const res = await fetch(`${base}/api/commands`, { headers: { "x-auth-key": key } });
    expect(res.status).toBe(200);
    const jobs = (await res.json()) as Array<{ id: string; status: string; reason: string }>;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(job.id);
    expect(jobs[0].status).toBe("waiting-approval");
    expect(jobs[0].reason).toBe("why");
  });

  it("does not leak internal fields (onKill/waiters) through the API", async () => {
    store.create({ tool: "run_bash_host", needsApproval: true, reason: "why", summary: "echo hi" });
    const res = await fetch(`${base}/api/commands`, { headers: { "x-auth-key": key } });
    const jobs = (await res.json()) as Array<Record<string, unknown>>;
    expect(jobs[0]).not.toHaveProperty("onKill");
    expect(jobs[0]).not.toHaveProperty("waiters");
  });

  it("approves a job via POST /api/commands/:id/approve", async () => {
    const job = store.create({ tool: "run_bash_container", needsApproval: false, summary: "x" });
    const dep = store.create({ tool: "run_bash_host", needsApproval: true, reason: "r", summary: "y", after: [] });
    const res = await fetch(`${base}/api/commands/${dep.id}/approve`, {
      method: "POST",
      headers: { "x-auth-key": key },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("running");
    expect(job.status).toBe("running");
  });

  it("rejects a job via POST /api/commands/:id/reject with a note", async () => {
    const job = store.create({ tool: "run_bash_host", needsApproval: true, reason: "r", summary: "y" });
    const res = await fetch(`${base}/api/commands/${job.id}/reject`, {
      method: "POST",
      headers: { "x-auth-key": key, "content-type": "application/json" },
      body: JSON.stringify({ note: "not today" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; note: string };
    expect(body.status).toBe("rejected");
    expect(body.note).toBe("not today");
  });

  it("rejects a job via POST with no body at all", async () => {
    const job = store.create({ tool: "run_bash_host", needsApproval: true, reason: "r", summary: "y" });
    const res = await fetch(`${base}/api/commands/${job.id}/reject`, {
      method: "POST",
      headers: { "x-auth-key": key },
    });
    expect(res.status).toBe(200);
    expect(job.status).toBe("rejected");
  });

  it("returns 400 for approving an unknown id", async () => {
    const res = await fetch(`${base}/api/commands/does-not-exist/approve`, {
      method: "POST",
      headers: { "x-auth-key": key },
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown route", async () => {
    const res = await fetch(`${base}/nope`, { headers: { "x-auth-key": key } });
    expect(res.status).toBe(404);
  });
});
