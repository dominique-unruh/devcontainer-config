import { vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Never actually spawn the approval window during tests; pretend it opened fine. The mint
// callback is still invoked, so the real bootstrap-file plumbing is exercised the way a
// genuine launch would exercise it.
vi.mock("../src/ui/window.js", () => ({
  ensureWindowOpen: vi.fn(async (mintUrl: () => Promise<string>) => {
    await mintUrl();
    return { ok: true };
  }),
}));

// Point the project/shared dir at a throwaway temp dir for the whole test run,
// so tool-level tests that write real files don't touch this repo.
process.env.PROJECT_DIR = mkdtempSync(join(tmpdir(), "claude-split-container-test-"));
