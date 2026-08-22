import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { TMP_DIR } from "./sharedDir.js";

export const LOG_PATH = join(TMP_DIR, "claude-split-container.log");

/**
 * Record a diagnostic line.
 *
 * Goes to a file as well as stderr, because an MCP server's stderr is captured
 * by the client and effectively invisible — without the file there is nowhere a
 * user can actually look to find out why something went wrong.
 */
export function logLine(message: string): void {
  const line = `${new Date().toISOString()} ${message}`;
  console.error(`[claude-split-container] ${message}`);
  try {
    mkdirSync(TMP_DIR, { recursive: true });
    appendFileSync(LOG_PATH, line + "\n");
  } catch {
    // Logging must never break the operation it is reporting on.
  }
}
