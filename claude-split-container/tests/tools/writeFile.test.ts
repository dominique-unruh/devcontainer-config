import { describe, it, expect } from "vitest";
import { readFile as fsReadFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFile } from "../../src/tools/writeFile.js";
import { jobStore } from "../../src/jobs.js";
import { PROJECT_DIR, writeTmpFile } from "../../src/sharedDir.js";
import { waitForJobStatus, parseToolResult } from "../helpers.js";

describe("write_file tool", () => {
  it("rejects a call with both sharedFile and content", async () => {
    await expect(
      writeFile({ destPath: "x.txt", sharedFile: "a", content: "b", reason: "r" } as never)
    ).rejects.toThrow(/exactly one of/);
  });

  it("rejects a call with neither sharedFile nor content", async () => {
    await expect(writeFile({ destPath: "x.txt", reason: "r" } as never)).rejects.toThrow(/exactly one of/);
  });

  it("writes literal content to the destination after approval", async () => {
    const destPath = join(PROJECT_DIR, "written-content.txt");
    const result = await writeFile({ destPath, content: "hello from content mode", reason: "r", background: true });
    const outcome = parseToolResult<{ id: string }>(result);
    jobStore.approve(outcome.id);
    const job = await waitForJobStatus(outcome.id, ["finished", "rejected"]);
    expect(job!.status).toBe("finished");
    expect((job!.result as { bytesWritten: number }).bytesWritten).toBe(Buffer.byteLength("hello from content mode"));
    expect(await fsReadFile(destPath, "utf8")).toBe("hello from content mode");
  });

  it("copies a shared-dir file to the destination after approval", async () => {
    const shared = await writeTmpFile("src", ".txt", "shared file contents");
    const destPath = join(PROJECT_DIR, "written-from-shared.txt");
    const result = await writeFile({ destPath, sharedFile: shared.name, reason: "r", background: true });
    const outcome = parseToolResult<{ id: string }>(result);
    jobStore.approve(outcome.id);
    const job = await waitForJobStatus(outcome.id, ["finished", "rejected"]);
    expect(job!.status).toBe("finished");
    expect(await fsReadFile(destPath, "utf8")).toBe("shared file contents");
  });

  it("creates parent directories as needed", async () => {
    const destPath = join(PROJECT_DIR, "nested", "dir", "file.txt");
    const result = await writeFile({ destPath, content: "deep", reason: "r", background: true });
    const outcome = parseToolResult<{ id: string }>(result);
    jobStore.approve(outcome.id);
    const job = await waitForJobStatus(outcome.id, ["finished", "rejected"]);
    expect(job!.status).toBe("finished");
    expect(await fsReadFile(destPath, "utf8")).toBe("deep");
  });
});
