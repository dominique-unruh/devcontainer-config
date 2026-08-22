import webview from "webview";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync } from "node:fs";
import { logLine } from "../log.js";
import { setUiStatus } from "./status.js";

const spawnWebview = webview.spawn;

/** How long to watch a freshly-spawned window before concluding it launched successfully. */
const LAUNCH_GRACE_MS = 1500;

let child: ChildProcess | undefined;
let binaryMadeExecutable = false;
/** Set once a fallback has been chosen, so we don't retry the doomed native window on every call. */
let browserFallbackActive = false;
let appModeActive = false;

export interface WindowLaunchResult {
  ok: boolean;
  /** Human-readable failure reason, present only when `ok` is false. */
  error?: string;
  /** Which surface the approval UI actually ended up on. */
  via?: "window" | "app-window" | "browser";
}

/** Platform command that opens a URL in the user's default browser. */
function browserOpener(): { cmd: string; args: string[] } {
  if (process.platform === "darwin") return { cmd: "open", args: [] };
  if (process.platform === "win32") return { cmd: "cmd", args: ["/c", "start", ""] };
  return { cmd: "xdg-open", args: [] };
}

/**
 * Chromium-family browsers that support `--app=<url>`, which opens a chromeless standalone window
 * (no tabs, no address bar) — the intended UI, without depending on the bundled webview binary.
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
    const probe = spawnSync(candidate.includes("/") ? "test" : "command",
      candidate.includes("/") ? ["-x", candidate] : ["-v", candidate],
      { shell: true, stdio: "ignore" }
    );
    if (probe.status === 0) return candidate;
  }
  return undefined;
}

/**
 * Open the dashboard as a chromeless browser window (`--app=`). This is the practical stand-in for
 * the native webview: a real standalone window, but using a browser the user already has, rather
 * than a bundled binary linked against an EOL system library.
 */
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
 * Last-resort fallback when the native window can't run: open the dashboard in the default
 * browser. A browser tab isn't the intended UI, but it beats the human never seeing the request.
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
 * The `webview` npm package ships its platform binary without the executable bit set (confirmed:
 * the published tarball itself has it as -rw-r--r--), so every consumer needs to chmod it before
 * the first spawn. Safe to call repeatedly — only actually touches the filesystem once.
 */
function ensureBinaryExecutable(): void {
  if (binaryMadeExecutable) return;
  try {
    chmodSync(webview.binaryPath, 0o755);
  } catch {
    // best-effort — if this fails, the spawn below will surface a clear error instead
  }
  binaryMadeExecutable = true;
}

/**
 * Open the dashboard in a standalone native window (lazily — call this only once there's actually
 * something for a human to look at). Reuses an already-open window if one exists rather than
 * spawning a second.
 *
 * Resolves only once the window has been observed to survive its first moments, so a caller can
 * tell the difference between "a window is up, the human will see this" and "nothing opened".
 * That distinction matters: without a window *and* without a caller-visible error, an
 * approval-gated tool call would block forever on approval that can never arrive.
 */
export async function ensureWindowOpen(url: string): Promise<WindowLaunchResult> {
  if (browserFallbackActive) return { ok: true, via: "browser" };
  if (child && child.exitCode === null && !child.killed) {
    return { ok: true, via: appModeActive ? "app-window" : "window" };
  }
  // An app-mode window that has since been closed: reopen it directly, skipping the webview
  // attempt we already know fails on this machine.
  if (appModeActive) return tryAppModeWindow(url);

  const native = await tryNativeWindow(url);
  if (native.ok) {
    setUiStatus({ surface: "window" });
    return native;
  }

  // The bundled webview binary is fragile — it links libwebkit2gtk-4.0, which current distros
  // (Arch, Ubuntu 24.04, …) have replaced with 4.1, so on an up-to-date Linux box it can never
  // start. A Chromium-family browser in --app mode gives the same chromeless standalone window
  // without depending on that binary at all.
  const appWindow = await tryAppModeWindow(url);
  if (appWindow.ok) {
    appModeActive = true;
    setUiStatus({ surface: "app-window", windowError: native.error });
    logLine(
      `Bundled webview unavailable, using a browser app-mode window instead. Reason: ${native.error}`
    );
    return appWindow;
  }

  const browser = await openInBrowser(url);
  if (browser.ok) {
    browserFallbackActive = true;
    setUiStatus({ surface: "browser", windowError: native.error, appWindowError: appWindow.error });
    logLine(
      `No standalone window available, using a browser tab instead. Webview: ${native.error} ` +
        `App mode: ${appWindow.error} (run \`claude-split-container --doctor\` for details)`
    );
    return browser;
  }

  setUiStatus({
    surface: "none",
    windowError: native.error,
    appWindowError: appWindow.error,
    browserError: browser.error,
  });
  logLine(
    `No approval UI could be opened. Webview: ${native.error} App mode: ${appWindow.error} ` +
      `Browser: ${browser.error}`
  );
  return {
    ok: false,
    error:
      `${native.error} A browser app-mode window also failed (${appWindow.error}), ` +
      `and opening a plain browser tab failed too: ${browser.error}.`,
  };
}

/**
 * Diagnose why the native approval window can't start, for `--doctor`. Returns a human-readable
 * report rather than throwing, so it is useful even when everything is broken.
 */
export async function diagnoseWindow(): Promise<string> {
  const lines: string[] = [];
  lines.push(`webview binary: ${webview.binaryPath}`);
  try {
    chmodSync(webview.binaryPath, 0o755);
    lines.push("executable bit: ok");
  } catch (err) {
    lines.push(`executable bit: FAILED (${err instanceof Error ? err.message : String(err)})`);
  }
  lines.push(`platform: ${process.platform}`);
  lines.push(`DISPLAY=${process.env.DISPLAY ?? "(unset)"} WAYLAND_DISPLAY=${process.env.WAYLAND_DISPLAY ?? "(unset)"}`);

  const probe = await tryNativeWindow("about:blank");
  if (probe.ok) {
    lines.push("bundled webview window: launched successfully");
    child?.kill();
    child = undefined;
  } else {
    lines.push(`bundled webview window: FAILED — ${probe.error}`);
  }

  const appBrowser = findAppModeBrowser();
  lines.push(
    appBrowser
      ? `browser app-mode window: available via ${appBrowser} (used when the webview fails)`
      : "browser app-mode window: no Chromium-family browser found"
  );
  lines.push(`plain browser tab: ${browserOpener().cmd} (last resort)`);

  if (!probe.ok) {
    lines.push("");
    if (appBrowser) {
      lines.push("The bundled webview binary links libwebkit2gtk-4.0, which recent distros have");
      lines.push("replaced with 4.1. That's fine — you'll get a chromeless standalone window from");
      lines.push(`${appBrowser} instead, which looks and behaves the same.`);
    } else {
      lines.push("The bundled webview binary links libwebkit2gtk-4.0, which recent distros have");
      lines.push("replaced with 4.1, and no Chromium-family browser was found for --app mode, so");
      lines.push("the dashboard opens as an ordinary browser tab. Installing any of");
      lines.push(`${APP_MODE_BROWSERS.slice(0, 3).join(", ")} would restore a standalone window.`);
    }
  }
  return lines.join("\n");
}

/** Attempt the native webview window, resolving with a failure result rather than throwing. */
function tryNativeWindow(url: string): Promise<WindowLaunchResult> {
  ensureBinaryExecutable();

  let opened: ChildProcess;
  try {
    opened = spawnWebview({ url, title: "claude-split-container", width: 720, height: 640 });
  } catch (err) {
    return Promise.resolve({
      ok: false,
      error: `could not spawn the webview binary: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  child = opened;

  let stderr = "";
  opened.stderr?.on("data", (d) => (stderr += d.toString()));

  return new Promise<WindowLaunchResult>((resolve) => {
    let settled = false;
    const settle = (result: WindowLaunchResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    opened.on("error", (err) => {
      child = undefined;
      settle({ ok: false, error: `could not start the approval window: ${err.message}` });
    });

    // A crash right after launch (no display available, or the system webview component isn't
    // installed) exits normally rather than emitting "error", so watch exits too.
    opened.on("exit", (code, signal) => {
      if (opened !== child) return;
      child = undefined;
      if (code === 0) {
        // The human closed the window; that's not a launch failure.
        settle({ ok: true, via: "window" });
        return;
      }
      settle({
        ok: false,
        error:
          `the approval window exited immediately (code ${code}, signal ${signal}). This usually ` +
          `means no display is available, or the system webview component (WebKitGTK on Linux / ` +
          `WebView2 on Windows / WKWebView on macOS) isn't installed.` +
          (stderr ? ` Details: ${stderr.trim()}` : ""),
      });
    });

    // Survived the grace period without erroring or exiting — treat it as up.
    const timer = setTimeout(() => settle({ ok: true, via: "window" }), LAUNCH_GRACE_MS);
    timer.unref();
  });
}
