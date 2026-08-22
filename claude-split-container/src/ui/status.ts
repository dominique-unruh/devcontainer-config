export type UiSurface = "none" | "app-window" | "browser";

export interface UiStatus {
  /** Where the approval UI actually ended up being shown. */
  surface: UiSurface;
  /** Why a standalone (browser app-mode) window couldn't be opened, when it couldn't. */
  appWindowError?: string;
  /** Why even a plain browser tab failed, when it did. */
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
  uiStatus.appWindowError = next.appWindowError;
  uiStatus.browserError = next.browserError;
}
