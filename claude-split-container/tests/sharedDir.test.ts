import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let projectDir: string;
let sharedDir: typeof import("../src/sharedDir.js");

beforeAll(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "claude-split-container-test-"));
  process.env.PROJECT_DIR = projectDir;
  sharedDir = await import("../src/sharedDir.js");
});

afterAll(async () => {
  delete process.env.PROJECT_DIR;
  await rm(projectDir, { recursive: true, force: true });
});

describe("sharedDir", () => {
  it("PROJECT_DIR/TMP_DIR resolve from the PROJECT_DIR env var", () => {
    expect(sharedDir.PROJECT_DIR).toBe(projectDir);
    expect(sharedDir.TMP_DIR).toBe(join(projectDir, ".tmp"));
  });

  it("writeTmpFile creates the file under .tmp and reports its size", async () => {
    const written = await sharedDir.writeTmpFile("out", ".stdout", "hello world");
    expect(written.name).toMatch(/^out-[0-9a-f]{8}\.stdout$/);
    expect(written.bytes).toBe(Buffer.byteLength("hello world"));
    const contents = await fsReadFile(sharedDir.tmpFilePath(written.name), "utf8");
    expect(contents).toBe("hello world");
  });

  it("writeTmpFile calls with the same prefix/suffix produce distinct files", async () => {
    const a = await sharedDir.writeTmpFile("dup", ".txt", "a");
    const b = await sharedDir.writeTmpFile("dup", ".txt", "b");
    expect(a.name).not.toBe(b.name);
  });

  it("copyIntoTmpDir copies an absolute source path and preserves its basename", async () => {
    const sourcePath = join(projectDir, "source-file.txt");
    await fsWriteFile(sourcePath, "copied content");
    const copied = await sharedDir.copyIntoTmpDir(sourcePath);
    expect(copied.name.endsWith("-source-file.txt")).toBe(true);
    const contents = await fsReadFile(sharedDir.tmpFilePath(copied.name), "utf8");
    expect(contents).toBe("copied content");
  });

  it("copyIntoTmpDir resolves a relative source path against PROJECT_DIR", async () => {
    await fsWriteFile(join(projectDir, "relative.txt"), "rel content");
    const copied = await sharedDir.copyIntoTmpDir("relative.txt");
    const contents = await fsReadFile(sharedDir.tmpFilePath(copied.name), "utf8");
    expect(contents).toBe("rel content");
  });

  it("tmpFilePath joins a name onto TMP_DIR", () => {
    expect(sharedDir.tmpFilePath("foo.txt")).toBe(join(sharedDir.TMP_DIR, "foo.txt"));
  });
});
