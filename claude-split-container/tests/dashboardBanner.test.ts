import { describe, it, expect, afterEach, vi } from "vitest";
import { JSDOM } from "jsdom";
import { DASHBOARD_HTML } from "../src/ui/dashboardHtml.js";

let dom: JSDOM;

/** Boot the dashboard page with a stubbed API returning the given jobs and ui-status. */
async function boot(jobs: unknown[], uiStatus: unknown) {
  dom = new JSDOM(DASHBOARD_HTML, {
    runScripts: "dangerously",
    url: "http://127.0.0.1:1234/?key=testkey",
  });
  (dom.window as unknown as { fetch: unknown }).fetch = vi.fn(async (path: string) => ({
    ok: true,
    json: async () => (path.includes("ui-status") ? uiStatus : jobs),
    text: async () => "",
  }));
  const handle = (dom.window as unknown as { __dashboard: { refresh: () => Promise<void> } }).__dashboard;
  await handle.refresh();
  return handle;
}

function banner() {
  return dom.window.document.getElementById("banner")!;
}

afterEach(() => dom?.window.close());

describe("approval-UI degradation banner", () => {
  it("explains the fallback, and points at --doctor and the log", async () => {
    await boot([], {
      surface: "browser",
      windowError: "the approval window exited immediately (code 127).",
      logPath: "/proj/.tmp/claude-split-container.log",
    });

    expect(banner().className).not.toContain("hidden");
    const text = banner().textContent!;
    expect(text).toContain("could not be opened");
    expect(text).toContain("code 127");
    expect(text).toContain("claude-split-container --doctor");
    expect(text).toContain("/proj/.tmp/claude-split-container.log");
  });

  it("stays hidden when the native window is working", async () => {
    await boot([], { surface: "window" });
    expect(banner().className).toContain("hidden");
  });

  it("stays hidden for a browser app-mode window, which is still a standalone window", async () => {
    await boot([], { surface: "app-window", windowError: "webview missing libwebkit2gtk-4.0" });
    expect(banner().className).toContain("hidden");
  });

  it("stays hidden when the server reports no degradation reason", async () => {
    await boot([], { surface: "browser" });
    expect(banner().className).toContain("hidden");
  });

  it("does not accumulate duplicate text across refreshes", async () => {
    const handle = await boot([], {
      surface: "browser",
      windowError: "boom",
      logPath: "/proj/.tmp/x.log",
    });
    await handle.refresh();
    await handle.refresh();
    const occurrences = banner().textContent!.split("boom").length - 1;
    expect(occurrences).toBe(1);
  });
});
