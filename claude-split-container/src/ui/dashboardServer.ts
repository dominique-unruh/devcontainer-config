import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { jobStore as defaultJobStore, type JobRecord, type JobStore } from "../jobs.js";
import { DASHBOARD_HTML } from "./dashboardHtml.js";
import { uiStatus } from "./status.js";
import { LOG_PATH, logLine } from "../log.js";

/** Name of the session cookie the dashboard authenticates with. */
const SESSION_COOKIE = "claude_split_container_session";

/** How long a redeemed session stays valid, in seconds. */
const SESSION_MAX_AGE = 24 * 60 * 60;

export interface Bootstrap {
  /** `file://` URL of the one-time entry page — safe to pass on a command line. */
  url: string;
  /** Filesystem path behind `url`, for telling a human which file to open. */
  path: string;
}

export interface DashboardHandle {
  /** Origin of the dashboard, e.g. `http://127.0.0.1:41234`. Carries no secret. */
  origin: string;
  /**
   * Mint a fresh single-use entry page and return its `file://` URL.
   *
   * The token lives inside a 0600 file rather than in the URL, because the URL is what gets
   * handed to the browser as a command-line argument — and argv is world-readable on Linux
   * (`/proc/<pid>/cmdline`). Anything secret in it would be readable by every other account on
   * the machine for as long as the browser runs, which would defeat the point of gating the
   * dashboard at all.
   */
  newBootstrap: () => Promise<Bootstrap>;
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

/** Constant-time secret comparison that tolerates a missing or differently-sized candidate. */
function secretEquals(candidate: string | undefined, secret: string): boolean {
  if (candidate === undefined) return false;
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Pull this server's session cookie out of a request's `Cookie` header, if present. */
function sessionFromRequest(req: IncomingMessage): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * Create a private directory for the bootstrap file. `$XDG_RUNTIME_DIR` is a per-user tmpfs
 * already mounted 0700, so nothing lands in shared `/tmp`; `mkdtemp` gives 0700 either way.
 */
async function makePrivateDir(): Promise<string> {
  const base = process.env.XDG_RUNTIME_DIR ?? tmpdir();
  return mkdtemp(join(base, "claude-split-container-"));
}

/** The one-time entry page: a plain redirect into the dashboard, carrying the token. */
function bootstrapPage(origin: string, token: string): string {
  const target = `${origin}/bootstrap?t=${token}`;
  return (
    `<!doctype html><meta charset="utf-8"><title>claude-split-container</title>` +
    `<meta http-equiv="refresh" content="0;url=${target}">` +
    `<p>Opening the approval dashboard&hellip; <a href="${target}">continue</a></p>`
  );
}

function unauthorized(res: ServerResponse) {
  res.writeHead(401, { "content-type": "text/plain" });
  res.end("unauthorized");
}

/**
 * A human who lands on `/` without a session gets an explanation rather than the bare word
 * "unauthorized" — this is the visible symptom if the one-time entry link was never opened, was
 * already spent, or the browser dropped the cookie, and none of those are guessable from a 401.
 */
function unauthorizedPage(res: ServerResponse) {
  res.writeHead(401, { "content-type": "text/html; charset=utf-8" });
  res.end(
    `<!doctype html><meta charset="utf-8"><title>claude-split-container</title>` +
      `<body style="font-family:system-ui,sans-serif;background:#1e1e1e;color:#ddd;padding:2rem;line-height:1.5">` +
      `<h1 style="font-size:1.1rem">Not signed in to the approval dashboard</h1>` +
      `<p>This page is reached through a one-time link, which is written to a private file when a ` +
      `command needs approving. That link has not been opened, or has already been used.</p>` +
      `<p>The next command that needs approval writes a fresh link and opens it for you. Every ` +
      `link written is also recorded in <code>${LOG_PATH}</code>, so the current one can be ` +
      `opened by hand from there.</p>`
  );
}

/**
 * Start the local-only (127.0.0.1, ephemeral port) approval-dashboard HTTP server: serves the
 * dashboard page and a small JSON API (list/approve/reject).
 *
 * Authentication is an `HttpOnly` session cookie. The browser obtains it by opening a one-time
 * `file://` bootstrap page (mode 0600) that redirects through `/bootstrap?t=<token>`; see
 * `DashboardHandle.newBootstrap` for why the token cannot simply live in the launch URL.
 *
 * `store` defaults to the shared singleton; overridable for tests.
 */
export async function startDashboardServer(store: JobStore = defaultJobStore): Promise<DashboardHandle> {
  const session = randomBytes(24).toString("base64url");
  let bootstrapToken: string | undefined;
  let bootstrapDir: string | undefined;

  /** Remove the outstanding bootstrap file, if any. Safe to call repeatedly. */
  const discardBootstrap = async () => {
    const dir = bootstrapDir;
    bootstrapDir = undefined;
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const authed = secretEquals(sessionFromRequest(req), session);

      // The only route reachable without a session: trade the one-time token from the 0600
      // bootstrap file for the session cookie. An already-authenticated browser is waved
      // through, so reopening the window with a spent token still lands on the dashboard.
      if (req.method === "GET" && url.pathname === "/bootstrap") {
        const redeemable =
          bootstrapToken !== undefined && secretEquals(url.searchParams.get("t") ?? undefined, bootstrapToken);
        if (!redeemable && !authed) {
          unauthorized(res);
          return;
        }
        if (redeemable) {
          bootstrapToken = undefined; // single use
          // Awaited, not fire-and-forget: the file must be gone by the time anyone could act on
          // the response, so a scraper never has a window to read a token that still works.
          await discardBootstrap();
        }
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "referrer-policy": "no-referrer",
          "set-cookie": `${SESSION_COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}`,
        });
        // Hopping to `/` from here rather than 302-ing straight from the `file://` page: a
        // redirect chain that *starts* cross-site can have SameSite=Strict cookies withheld,
        // whereas this navigation is same-site and always carries it. `location.replace` also
        // drops the token-bearing URL from history.
        res.end(
          `<!doctype html><meta charset="utf-8"><title>claude-split-container</title>` +
            `<meta http-equiv="refresh" content="0;url=/"><script>location.replace("/")</script>`
        );
        return;
      }

      if (!authed) {
        if (req.method === "GET" && url.pathname === "/") unauthorizedPage(res);
        else unauthorized(res);
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

  const origin = `http://127.0.0.1:${address.port}`;

  const newBootstrap = async (): Promise<Bootstrap> => {
    await discardBootstrap();
    const token = randomBytes(24).toString("base64url");
    const dir = await makePrivateDir();
    const path = join(dir, "open-approval-dashboard.html");
    await writeFile(path, bootstrapPage(origin, token), { mode: 0o600 });
    bootstrapToken = token;
    bootstrapDir = dir;
    // The path is safe to record — the token is inside the 0600 file, not in its name — and
    // this is the only trail back to the dashboard if the window fails to open.
    logLine(`Approval dashboard entry link: ${path}`);
    return { url: pathToFileURL(path).href, path };
  };

  return {
    origin,
    newBootstrap,
    close: async () => {
      await discardBootstrap();
      await new Promise<void>((resolveClose, rejectClose) => {
        // Idempotent: closing twice is not an error worth propagating, and the bootstrap file
        // is gone either way.
        if (!server.listening) return resolveClose();
        server.close((err) => (err ? rejectClose(err) : resolveClose()));
      });
    },
  };
}
