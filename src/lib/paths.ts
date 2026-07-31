import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Repo root is found by walking up from this file looking for
// package.json + features/, so it works both under tsx (src/lib/) and the
// esbuild bundle (dist/devcontainer-config), which inlines this file's
// content in place.
const here = path.dirname(fileURLToPath(import.meta.url));

function looksLikeRepoRoot(dir: string): boolean {
  return existsSync(path.join(dir, "package.json")) && existsSync(path.join(dir, "features"));
}

function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (looksLikeRepoRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`could not locate devcontainer-config repo root above ${start}`);
    }
    dir = parent;
  }
}

export const REPO_DIR = findRepoRoot(here);
export const SOURCE_FEATURES_DIR = path.join(REPO_DIR, "features");

export const DEVCONTAINER_DIR = ".devcontainer";
export const DEVCONTAINER_JSON = path.join(DEVCONTAINER_DIR, "devcontainer.json");
export const PROJECT_FEATURES_DIR = path.join(DEVCONTAINER_DIR, "features");
