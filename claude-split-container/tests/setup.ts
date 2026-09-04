import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the project/shared dir at a throwaway temp dir for the whole test run,
// so tool-level tests that write real files don't touch this repo.
process.env.PROJECT_DIR = mkdtempSync(join(tmpdir(), "claude-split-container-test-"));
