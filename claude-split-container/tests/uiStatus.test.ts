import { describe, it, expect, beforeEach } from "vitest";
import { uiStatus, setUiStatus } from "../src/ui/status.js";

describe("uiStatus", () => {
  beforeEach(() => setUiStatus({ surface: "none" }));

  it("records the surface actually used", () => {
    setUiStatus({ surface: "app-window" });
    expect(uiStatus.surface).toBe("app-window");
    expect(uiStatus.appWindowError).toBeUndefined();
  });

  it("clears stale errors when a later attempt succeeds outright", () => {
    setUiStatus({ surface: "browser", appWindowError: "a", browserError: "b" });
    setUiStatus({ surface: "app-window" });
    expect(uiStatus.appWindowError).toBeUndefined();
    expect(uiStatus.browserError).toBeUndefined();
  });

  it("keeps every failure reason when nothing could be opened", () => {
    setUiStatus({ surface: "none", appWindowError: "a", browserError: "b" });
    expect(uiStatus).toMatchObject({
      surface: "none",
      appWindowError: "a",
      browserError: "b",
    });
  });
});
