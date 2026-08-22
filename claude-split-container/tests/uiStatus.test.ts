import { describe, it, expect, beforeEach } from "vitest";
import { uiStatus, setUiStatus } from "../src/ui/status.js";

describe("uiStatus", () => {
  beforeEach(() => setUiStatus({ surface: "none" }));

  it("records the surface actually used", () => {
    setUiStatus({ surface: "app-window", windowError: "webview missing lib" });
    expect(uiStatus.surface).toBe("app-window");
    expect(uiStatus.windowError).toBe("webview missing lib");
  });

  it("clears stale errors when a later attempt succeeds outright", () => {
    setUiStatus({ surface: "browser", windowError: "a", appWindowError: "b", browserError: "c" });
    setUiStatus({ surface: "window" });
    expect(uiStatus.windowError).toBeUndefined();
    expect(uiStatus.appWindowError).toBeUndefined();
    expect(uiStatus.browserError).toBeUndefined();
  });

  it("keeps every failure reason when nothing could be opened", () => {
    setUiStatus({ surface: "none", windowError: "a", appWindowError: "b", browserError: "c" });
    expect(uiStatus).toMatchObject({
      surface: "none",
      windowError: "a",
      appWindowError: "b",
      browserError: "c",
    });
  });
});
