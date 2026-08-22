import { describe, it, expect } from "vitest";
import { writeFile as fsWriteFile, readFile as fsReadFile, mkdtemp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { patchFile } from "../../src/tools/patchFile.js";
import { jobStore } from "../../src/jobs.js";
import { PROJECT_DIR } from "../../src/sharedDir.js";
import { waitForJobStatus, parseToolResult } from "../helpers.js";

/** Build a real unified diff between two strings using the system `diff` tool. */
async function makeDiff(oldContent: string, newContent: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "diff-"));
  const oldPath = join(dir, "a");
  const newPath = join(dir, "b");
  await fsWriteFile(oldPath, oldContent);
  await fsWriteFile(newPath, newContent);
  try {
    return execFileSync("diff", ["-u", oldPath, newPath], { encoding: "utf8" });
  } catch (err) {
    // diff exits 1 when files differ, which is the expected/successful case here
    return (err as { stdout: string }).stdout;
  }
}

describe("patch_file tool", () => {
  it("applies a clean patch and reports success", async () => {
    const targetPath = join(PROJECT_DIR, "patch-target.txt");
    await fsWriteFile(targetPath, "line1\nline2\nline3\n");
    const patch = await makeDiff("line1\nline2\nline3\n", "line1\nline2-changed\nline3\n");

    const result = await patchFile({ targetPath, patch, reason: "fix line 2", background: true });
    const outcome = parseToolResult<{ id: string }>(result);
    jobStore.approve(outcome.id);
    const job = await waitForJobStatus(outcome.id, ["finished", "rejected"]);
    expect(job!.status).toBe("finished");
    expect(job!.result).toEqual({ applied: true });
    expect(await fsReadFile(targetPath, "utf8")).toBe("line1\nline2-changed\nline3\n");
  });

  it("fails atomically (dry-run) and leaves the file untouched when the patch doesn't apply", async () => {
    const targetPath = join(PROJECT_DIR, "patch-target-2.txt");
    await fsWriteFile(targetPath, "completely different content\n");
    const patch = await makeDiff("line1\nline2\nline3\n", "line1\nline2-changed\nline3\n");

    const result = await patchFile({ targetPath, patch, reason: "fix line 2", background: true });
    const outcome = parseToolResult<{ id: string }>(result);
    jobStore.approve(outcome.id);
    const job = await waitForJobStatus(outcome.id, ["finished", "rejected"]);
    expect(job!.status).toBe("finished");
    expect((job!.result as { error: string }).error).toMatch(/does not apply/);
    expect(await fsReadFile(targetPath, "utf8")).toBe("completely different content\n");
  });
});
