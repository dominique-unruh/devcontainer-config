import { randomBytes } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { mkdir, stat, writeFile, copyFile } from "node:fs/promises";

export const PROJECT_DIR = resolveProjectDir();
export const TMP_DIR = join(PROJECT_DIR, ".tmp");

/** Resolve the project (= shared) dir: `--project-dir` arg, then `PROJECT_DIR` env var, then `process.cwd()`. */
function resolveProjectDir(): string {
  const argIdx = process.argv.indexOf("--project-dir");
  const fromArg = argIdx !== -1 ? process.argv[argIdx + 1] : undefined;
  const dir = fromArg ?? process.env.PROJECT_DIR ?? process.cwd();
  return resolve(dir);
}

/** Create the shared `.tmp` dir if it doesn't exist yet. */
export async function ensureTmpDir(): Promise<void> {
  await mkdir(TMP_DIR, { recursive: true });
}

/** A short random hex string used to keep generated `.tmp` filenames unique. */
function shortId(): string {
  return randomBytes(4).toString("hex");
}

export interface WrittenFile {
  name: string;
  bytes: number;
}

/** Write text/buffer content to a new file in .tmp, named `<prefix>-<shortid><suffix>`. */
export async function writeTmpFile(
  prefix: string,
  suffix: string,
  data: string | Buffer
): Promise<WrittenFile> {
  await ensureTmpDir();
  const name = `${prefix}-${shortId()}${suffix}`;
  const path = join(TMP_DIR, name);
  await writeFile(path, data);
  const st = await stat(path);
  return { name, bytes: st.size };
}

/** Copy an arbitrary host file into .tmp, named `<shortid>-<basename>`. */
export async function copyIntoTmpDir(sourcePath: string): Promise<WrittenFile> {
  await ensureTmpDir();
  const name = `${shortId()}-${basename(sourcePath)}`;
  const dest = join(TMP_DIR, name);
  await copyFile(resolve(PROJECT_DIR, sourcePath), dest);
  const st = await stat(dest);
  return { name, bytes: st.size };
}

/** Resolve a filename the caller says lives in the project dir's .tmp/ subdir into an absolute path. */
export function tmpFilePath(name: string): string {
  return join(TMP_DIR, name);
}
