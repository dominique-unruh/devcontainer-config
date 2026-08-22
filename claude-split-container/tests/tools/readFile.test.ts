import { describe, it, expect } from "vitest";
import { writeFile as fsWriteFile, readFile as fsReadFile } from "node:fs/promises";
import { join } from "node:path";
import { readFile } from "../../src/tools/readFile.js";
import { jobStore } from "../../src/jobs.js";
import { PROJECT_DIR, tmpFilePath } from "../../src/sharedDir.js";
import { waitForJobStatus, parseToolResult } from "../helpers.js";

describe("read_file tool", () => {
  it("copies a host file into .tmp only after approval", async () => {
    const sourcePath = join(PROJECT_DIR, "secret.txt");
    await fsWriteFile(sourcePath, "top secret contents");

    const result = await readFile({ path: sourcePath, reason: "need it", background: true });
    const outcome = parseToolResult<{ id: string }>(result);
    expect(jobStore.get(outcome.id)!.status).toBe("waiting-approval");

    jobStore.approve(outcome.id);
    const job = await waitForJobStatus(outcome.id, ["finished", "rejected"]);
    expect(job!.status).toBe("finished");
    const finalResult = job!.result as { file: { name: string; bytes: number } };
    expect(finalResult.file.name.endsWith("-secret.txt")).toBe(true);

    const copied = await fsReadFile(tmpFilePath(finalResult.file.name), "utf8");
    expect(copied).toBe("top secret contents");
  });

  it("a missing source file resolves to a finished job with an error, not a thrown exception", async () => {
    const result = await readFile({
      path: join(PROJECT_DIR, "does-not-exist.txt"),
      reason: "need it",
      background: true,
    });
    const outcome = parseToolResult<{ id: string }>(result);
    jobStore.approve(outcome.id);
    const job = await waitForJobStatus(outcome.id, ["finished", "rejected"]);
    expect(job!.status).toBe("finished");
    expect((job!.result as { error: string }).error).toBeDefined();
  });
});
