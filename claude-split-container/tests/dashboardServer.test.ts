import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { JobStore } from "../src/jobs.js";
import { startDashboardServer, type DashboardHandle } from "../src/ui/dashboardServer.js";
import { redeemBootstrap, bootstrapTargetOf } from "./helpers.js";

describe("dashboard server", () => {
  let store: JobStore;
  let dashboard: DashboardHandle;
  let base: string;
  let cookie: string;

  beforeEach(async () => {
    store = new JobStore();
    dashboard = await startDashboardServer(store);
    base = dashboard.origin;
    cookie = await redeemBootstrap(dashboard);
  });

  afterEach(async () => {
    await dashboard.close();
  });

  it("rejects every route without a session cookie", async () => {
    for (const path of ["/", "/api/commands", "/api/ui-status", "/nope"]) {
      expect((await fetch(`${base}${path}`)).status, path).toBe(401);
    }
  });

  it("explains itself, rather than saying just 'unauthorized', to a human landing on /", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).toContain("one-time link");
    expect(body).toContain("claude-split-container.log");
  });

  it("rejects a forged session cookie", async () => {
    const res = await fetch(`${base}/api/commands`, {
      headers: { cookie: "claude_split_container_session=wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("serves the dashboard page at / with the session cookie", async () => {
    const res = await fetch(`${base}/`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("claude-split-container");
  });

  it("lists jobs via GET /api/commands", async () => {
    const job = store.create({ tool: "run_bash_host", needsApproval: true, reason: "why", summary: "echo hi" });
    const res = await fetch(`${base}/api/commands`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const jobs = (await res.json()) as Array<{ id: string; status: string; reason: string }>;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(job.id);
    expect(jobs[0].status).toBe("waiting-approval");
    expect(jobs[0].reason).toBe("why");
  });

  it("does not leak internal fields (onKill/waiters) through the API", async () => {
    store.create({ tool: "run_bash_host", needsApproval: true, reason: "why", summary: "echo hi" });
    const res = await fetch(`${base}/api/commands`, { headers: { cookie } });
    const jobs = (await res.json()) as Array<Record<string, unknown>>;
    expect(jobs[0]).not.toHaveProperty("onKill");
    expect(jobs[0]).not.toHaveProperty("waiters");
  });

  it("approves a job via POST /api/commands/:id/approve", async () => {
    const job = store.create({ tool: "run_bash_container", needsApproval: false, summary: "x" });
    const dep = store.create({ tool: "run_bash_host", needsApproval: true, reason: "r", summary: "y", after: [] });
    const res = await fetch(`${base}/api/commands/${dep.id}/approve`, {
      method: "POST",
      headers: { cookie },
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
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ note: "not today" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; note: string };
    expect(body.status).toBe("rejected");
    expect(body.note).toBe("not today");
  });

  it("rejects a job via POST with no body at all", async () => {
    const job = store.create({ tool: "run_bash_host", needsApproval: true, reason: "r", summary: "y" });
    const res = await fetch(`${base}/api/commands/${job.id}/reject`, { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    expect(job.status).toBe("rejected");
  });

  it("returns 400 for approving an unknown id", async () => {
    const res = await fetch(`${base}/api/commands/does-not-exist/approve`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown route", async () => {
    const res = await fetch(`${base}/nope`, { headers: { cookie } });
    expect(res.status).toBe(404);
  });
});

// These are the point of the bootstrap indirection: the string handed to the browser on the
// command line — world-readable via /proc on Linux — must be useless to anyone who reads it.
describe("dashboard bootstrap", () => {
  let dashboard: DashboardHandle;

  beforeEach(async () => {
    dashboard = await startDashboardServer(new JobStore());
  });

  afterEach(async () => {
    await dashboard.close();
  });

  it("keeps the token out of the launch URL, and the launch URL out of the network", async () => {
    const { url, path } = await dashboard.newBootstrap();
    expect(url.startsWith("file://")).toBe(true);
    expect(url).not.toContain("t=");
    expect(url).not.toContain("?");
    // The secret is in the file the URL points at, not in the URL itself.
    const token = new URL(bootstrapTargetOf(await readFile(path, "utf8"))).searchParams.get("t")!;
    expect(token.length).toBeGreaterThan(20);
    expect(url).not.toContain(token);
  });

  it("writes the bootstrap file 0600", async () => {
    const { path } = await dashboard.newBootstrap();
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("rejects a bogus bootstrap token", async () => {
    await dashboard.newBootstrap();
    const res = await fetch(`${dashboard.origin}/bootstrap?t=nope`);
    expect(res.status).toBe(401);
  });

  it("burns the token and deletes the file on redemption", async () => {
    const { path } = await dashboard.newBootstrap();
    const target = bootstrapTargetOf(await readFile(path, "utf8"));

    const first = await fetch(target);
    expect(first.status).toBe(200);
    expect(first.headers.get("set-cookie")).toContain("HttpOnly");
    expect(first.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(existsSync(path)).toBe(false);

    // A second reader of the same token — e.g. someone who scraped it before it was spent —
    // gets nothing.
    expect((await fetch(target)).status).toBe(401);
  });

  it("lets an already-authenticated browser back in with a spent token", async () => {
    const { path } = await dashboard.newBootstrap();
    const target = bootstrapTargetOf(await readFile(path, "utf8"));
    const cookie = (await fetch(target)).headers.get("set-cookie")!.split(";")[0];

    // Reopening the window re-visits the stale entry URL; it must land on the dashboard
    // rather than 401 just because the token is used up.
    const again = await fetch(target, { headers: { cookie } });
    expect(again.status).toBe(200);
  });

  it("discards the previous bootstrap file when a new one is minted", async () => {
    const first = await dashboard.newBootstrap();
    const second = await dashboard.newBootstrap();
    expect(existsSync(first.path)).toBe(false);
    expect(existsSync(second.path)).toBe(true);
  });

  it("cleans up the bootstrap file on close", async () => {
    const { path } = await dashboard.newBootstrap();
    await dashboard.close();
    expect(existsSync(path)).toBe(false);
  });
});
