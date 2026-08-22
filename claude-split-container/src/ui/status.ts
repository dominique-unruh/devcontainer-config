export type UiSurface = "none" | "window" | "browser";

export interface UiStatus {
  /** Where the approval UI actually ended up being shown. */
  surface: UiSurface;
  /** Why the native window wasn't used, when it wasn't. */
  windowError?: string;
  /** Why the browser fallback also failed, when it did. */
  browserError?: string;
}

/**
 * Live record of how the approval UI is being displayed, so the failure reason
 * can be surfaced to the human (dashboard banner) and to the model (tool result
 * warning) rather than disappearing into the server's stderr.
 */
export const uiStatus: UiStatus = { surface: "none" };

/** Record which surface the approval UI is using, and why the better one was unavailable. */
export function setUiStatus(next: UiStatus): void {
  uiStatus.surface = next.surface;
  uiStatus.windowError = next.windowError;
  uiStatus.browserError = next.browserError;
}
