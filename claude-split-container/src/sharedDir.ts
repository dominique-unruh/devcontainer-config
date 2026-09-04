import { resolve } from "node:path";

export const PROJECT_DIR = resolveProjectDir();

/** Resolve the project (= shared) dir: `--project-dir` arg, then `PROJECT_DIR` env var, then `process.cwd()`. */
function resolveProjectDir(): string {
  const argIdx = process.argv.indexOf("--project-dir");
  const fromArg = argIdx !== -1 ? process.argv[argIdx + 1] : undefined;
  const dir = fromArg ?? process.env.PROJECT_DIR ?? process.cwd();
  return resolve(dir);
}
