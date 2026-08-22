import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { logLine } from "../log.js";
import { setUiStatus } from "./status.js";

/** How long to watch a freshly-spawned window before concluding it launched successfully. */
const LAUNCH_GRACE_MS = 1500;

let child: ChildProcess | undefined;
/** Set once we've fallen back to a plain tab, so we stop retrying the app-mode window each time. */
let browserFallbackActive = false;

export interface WindowLaunchResult {
  ok: boolean;
  /** Human-readable failure reason, present only when `ok` is false. */
  error?: string;
  /** Which surface the approval UI actually ended up on. */
  via?: "app-window" | "browser";
}

/** Platform command that opens a URL in the user's default browser. */
function browserOpener(): { cmd: string; args: string[] } {
  if (process.platform === "darwin") return { cmd: "open", args: [] };
  if (process.platform === "win32") return { cmd: "cmd", args: ["/c", "start", ""] };
  return { cmd: "xdg-open", args: [] };
}

/**
 * Chromium-family browsers that support `--app=<url>`, which opens a chromeless standalone window
 * (no tabs, no address bar).
 *
 * This replaced a bundled native-webview binary, which was dropped: it was linked against
 * libwebkit2gtk-4.0, an EOL library current distros have replaced with 4.1, so it failed to start
 * on any up-to-date Linux machine and always ended up here anyway — at the cost of a ~32MB
 * dependency and a confusing first-run failure.
 */
const APP_MODE_BROWSERS =
  process.platform === "darwin"
    ? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      ]
    : process.platform === "win32"
      ? ["chrome.exe", "msedge.exe"]
      : [
          "chromium",
          "chromium-browser",
          "google-chrome-stable",
          "google-chrome",
          "brave",
          "brave-browser",
          "microsoft-edge-stable",
          "microsoft-edge",
          "vivaldi",
        ];

/** First app-mode-capable browser present on this machine, if any. */
export function findAppModeBrowser(): string | undefined {
  for (const candidate of APP_MODE_BROWSERS) {
    const isPath = candidate.includes("/");
    const probe = spawnSync(
      isPath ? "test" : "command",
      isPath ? ["-x", candidate] : ["-v", candidate],
      { shell: true, stdio: "ignore" }
    );
    if (probe.status === 0) return candidate;
  }
  return undefined;
}

/** Open the dashboard as a chromeless standalone window via a Chromium-family browser. */
function tryAppModeWindow(url: string): Promise<WindowLaunchResult> {
  const browser = findAppModeBrowser();
  if (!browser) {
    return Promise.resolve({ ok: false, error: "no Chromium-family browser found for --app mode" });
  }

  let opened: ChildProcess;
  try {
    opened = spawn(browser, [`--app=${url}`, "--window-size=760,680"], { stdio: "ignore" });
  } catch (err) {
    return Promise.resolve({
      ok: false,
      error: `${browser} --app failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  child = opened;

  return new Promise((resolve) => {
    let settled = false;
    const settle = (r: WindowLaunchResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    opened.on("error", (err) => {
      child = undefined;
      settle({ ok: false, error: `${browser} --app failed: ${err.message}` });
    });
    opened.on("exit", (code) => {
      if (opened !== child) return;
      child = undefined;
      // Exit 0 usually means it handed off to an already-running instance of the same browser,
      // which still produces the window — so only a non-zero exit counts as a failure.
      if (code === 0) return settle({ ok: true, via: "app-window" });
      settle({ ok: false, error: `${browser} --app exited with code ${code}` });
    });
    const timer = setTimeout(() => settle({ ok: true, via: "app-window" }), LAUNCH_GRACE_MS);
    timer.unref();
  });
}

/**
 * Last-resort fallback: open the dashboard in the default browser. A tab isn't the intended UI,
 * but it beats the human never seeing the request.
 */
function openInBrowser(url: string): Promise<WindowLaunchResult> {
  const { cmd, args } = browserOpener();
  return new Promise((resolve) => {
    let settled = false;
    const settle = (r: WindowLaunchResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    let opener: ChildProcess;
    try {
      opener = spawn(cmd, [...args, url], { stdio: "ignore", detached: true });
    } catch (err) {
      settle({ ok: false, error: `${cmd} failed: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    opener.unref();
    opener.on("error", (err) => settle({ ok: false, error: `${cmd} failed: ${err.message}` }));
    opener.on("exit", (code) =>
      code === 0
        ? settle({ ok: true, via: "browser" })
        : settle({ ok: false, error: `${cmd} exited with code ${code}` })
    );
    // Some openers linger; if it hasn't failed quickly, assume it worked.
    const timer = setTimeout(() => settle({ ok: true, via: "browser" }), 1500);
    timer.unref();
  });
}

/**
 * Show the dashboard in a standalone window (lazily — call this only once there's actually
 * something for a human to look at). Reuses an already-open window rather than spawning a second.
 *
 * `mintUrl` is called only when a launch actually happens, since the dashboard's entry URL is
 * single-use: minting one on a call that turns out to reuse an existing window would burn a
 * token nobody ever opens.
 *
 * Resolves only once the window has been observed to survive its first moments, so a caller can
 * tell the difference between "a window is up, the human will see this" and "nothing opened".
 * That distinction matters: without a window *and* without a caller-visible error, an
 * approval-gated tool call would block forever on approval that can never arrive.
 */
export async function ensureWindowOpen(mintUrl: () => Promise<string>): Promise<WindowLaunchResult> {
  if (browserFallbackActive) return { ok: true, via: "browser" };
  if (child && child.exitCode === null && !child.killed) {
    return { ok: true, via: "app-window" };
  }

  const url = await mintUrl();
  const appWindow = await tryAppModeWindow(url);
  if (appWindow.ok) {
    setUiStatus({ surface: "app-window" });
    return appWindow;
  }

  const browser = await openInBrowser(url);
  if (browser.ok) {
    browserFallbackActive = true;
    setUiStatus({ surface: "browser", appWindowError: appWindow.error });
    logLine(
      `No standalone window available, using a browser tab instead. Reason: ${appWindow.error} ` +
        `(run \`claude-split-container --doctor\` for details)`
    );
    return browser;
  }

  setUiStatus({ surface: "none", appWindowError: appWindow.error, browserError: browser.error });
  logLine(`No approval UI could be opened. App mode: ${appWindow.error} Browser: ${browser.error}`);
  return {
    ok: false,
    error:
      `Could not open a standalone approval window (${appWindow.error}), ` +
      `and opening a plain browser tab failed too: ${browser.error}.`,
  };
}

/**
 * Diagnose how the approval UI will be displayed, for `--doctor`. Returns a human-readable report
 * rather than throwing, so it is useful even when everything is broken.
 */
export async function diagnoseWindow(): Promise<string> {
  const lines: string[] = [];
  lines.push(`platform: ${process.platform}`);
  lines.push(
    `DISPLAY=${process.env.DISPLAY ?? "(unset)"} WAYLAND_DISPLAY=${process.env.WAYLAND_DISPLAY ?? "(unset)"}`
  );

  const appBrowser = findAppModeBrowser();
  lines.push(
    appBrowser
      ? `standalone window: available via ${appBrowser} --app`
      : "standalone window: UNAVAILABLE — no Chromium-family browser found"
  );
  lines.push(`plain browser tab: ${browserOpener().cmd} (last resort)`);

  if (!appBrowser) {
    lines.push("");
    lines.push("No Chromium-family browser was found, so the dashboard opens as an ordinary");
    lines.push("browser tab rather than its own window. Installing any of");
    lines.push(`${APP_MODE_BROWSERS.slice(0, 3).join(", ")} would restore a standalone window.`);
  }
  return lines.join("\n");
}
