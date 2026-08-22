import { vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Never actually spawn the native approval window during tests; pretend it opened fine.
vi.mock("../src/ui/window.js", () => ({
  ensureWindowOpen: vi.fn(async () => ({ ok: true })),
}));

// Point the project/shared dir at a throwaway temp dir for the whole test run,
// so tool-level tests that write real files don't touch this repo.
process.env.PROJECT_DIR = mkdtempSync(join(tmpdir(), "claude-split-container-test-"));
