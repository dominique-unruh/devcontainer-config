import { describe, it, expect } from "vitest";
import { readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import { join } from "node:path";
import { readFile } from "../../src/tools/readFile.js";
import { writeFile } from "../../src/tools/writeFile.js";
import { jobStore } from "../../src/jobs.js";
import { PROJECT_DIR } from "../../src/sharedDir.js";
import { waitForJobStatus, parseToolResult } from "../helpers.js";

/** Approve a backgrounded job and wait for it to settle. */
async function approveAndSettle(id: string) {
  jobStore.approve(id);
  return waitForJobStatus(id, ["finished", "rejected"]);
}

describe("shared-file name round trip", () => {
  it("a name returned by read_file can be handed straight back to write_file", async () => {
    const source = join(PROJECT_DIR, "round-trip-source.txt");
    await fsWriteFile(source, "round trip payload");

    const readResult = await readFile({ path: source, reason: "grab it", background: true });
    const readJob = await approveAndSettle(parseToolResult<{ id: string }>(readResult).id);
    const { file } = readJob!.result as { file: { name: string } };

    // This is the point of the .tmp/ prefix: the returned name is usable as-is.
    expect(file.name.startsWith(".tmp/")).toBe(true);

    const dest = join(PROJECT_DIR, "round-trip-dest.txt");
    const writeResult = await writeFile({
      destPath: dest,
      sharedFile: file.name,
      reason: "put it back",
      background: true,
    });
    const writeJob = await approveAndSettle(parseToolResult<{ id: string }>(writeResult).id);

    expect(writeJob!.status).toBe("finished");
    expect(writeJob!.result).not.toHaveProperty("error");
    expect(await fsReadFile(dest, "utf8")).toBe("round trip payload");
  });

  it("a bare filename (prefix stripped) still resolves", async () => {
    const source = join(PROJECT_DIR, "bare-source.txt");
    await fsWriteFile(source, "bare name payload");

    const readResult = await readFile({ path: source, reason: "grab it", background: true });
    const readJob = await approveAndSettle(parseToolResult<{ id: string }>(readResult).id);
    const { file } = readJob!.result as { file: { name: string } };

    const dest = join(PROJECT_DIR, "bare-dest.txt");
    const writeResult = await writeFile({
      destPath: dest,
      sharedFile: file.name.replace(/^\.tmp\//, ""),
      reason: "put it back",
      background: true,
    });
    const writeJob = await approveAndSettle(parseToolResult<{ id: string }>(writeResult).id);

    expect(writeJob!.result).not.toHaveProperty("error");
    expect(await fsReadFile(dest, "utf8")).toBe("bare name payload");
  });
});
