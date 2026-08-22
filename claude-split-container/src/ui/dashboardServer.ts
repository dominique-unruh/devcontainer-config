import { createServer, type IncomingMessage } from "node:http";
import { randomBytes } from "node:crypto";
import { jobStore as defaultJobStore, type JobRecord, type JobStore } from "../jobs.js";
import { DASHBOARD_HTML } from "./dashboardHtml.js";
import { uiStatus } from "./status.js";
import { LOG_PATH } from "../log.js";

export interface DashboardHandle {
  url: string;
  key: string;
  close: () => Promise<void>;
}

/** Strip a job record down to what the dashboard UI is allowed to see (drops internal fields like `onKill`/`waiters`). */
function publicJob(job: JobRecord) {
  return {
    id: job.id,
    tool: job.tool,
    status: job.status,
    reason: job.reason,
    summary: job.summary,
    note: job.note,
    result: job.result,
    createdAt: job.createdAt,
  };
}

/** Read and JSON-parse a request body; empty body parses to `{}`. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

/** Pull the auth key from the `x-auth-key` header, falling back to the `key` query param (used by the dashboard's own page load). */
function keyFromRequest(req: IncomingMessage, url: URL): string | undefined {
  return req.headers["x-auth-key"]?.toString() ?? url.searchParams.get("key") ?? undefined;
}

/**
 * Start the local-only (127.0.0.1, ephemeral port) approval-dashboard HTTP server: serves the
 * dashboard page and a small JSON API (list/approve/reject), all gated by a random key generated
 * here. `store` defaults to the shared singleton; overridable for tests.
 */
export async function startDashboardServer(store: JobStore = defaultJobStore): Promise<DashboardHandle> {
  const key = randomBytes(24).toString("base64url");

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const providedKey = keyFromRequest(req, url);

      if (providedKey !== key) {
        res.writeHead(401, { "content-type": "text/plain" });
        res.end("unauthorized");
        return;
      }

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(DASHBOARD_HTML);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/ui-status") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ...uiStatus, logPath: LOG_PATH }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/commands") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(store.list().map(publicJob)));
        return;
      }

      const approveMatch = url.pathname.match(/^\/api\/commands\/([^/]+)\/approve$/);
      if (req.method === "POST" && approveMatch) {
        const job = store.approve(approveMatch[1]);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(publicJob(job)));
        return;
      }

      const rejectMatch = url.pathname.match(/^\/api\/commands\/([^/]+)\/reject$/);
      if (req.method === "POST" && rejectMatch) {
        const body = (await readJsonBody(req)) as { note?: string };
        const job = store.reject(rejectMatch[1], body.note);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(publicJob(job)));
        return;
      }

      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    } catch (err) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end(err instanceof Error ? err.message : String(err));
    }
  });

  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("dashboard server failed to bind a port");
  }

  const url = `http://127.0.0.1:${address.port}/?key=${key}`;

  return {
    url,
    key,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((err) => (err ? rejectClose(err) : resolveClose()));
      }),
  };
}
