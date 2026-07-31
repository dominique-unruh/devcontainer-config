import { execFileSync } from "node:child_process";
import { REPO_DIR } from "./paths.js";

// Mirrors vagrant-config.py's git() helper: best-effort, returns undefined
// instead of throwing if git/remote/repo isn't available.
function git(...args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", REPO_DIR, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

// Cosmetic only (shown in provenance messages) — staleness itself is
// judged by content hash (see provenance.ts), not by git history.
export function sourceRemote(): string {
  return git("remote", "get-url", "origin") ?? "<no remote>";
}
