import { rebuild } from "../lib/build.js";

export async function cmdRebuild(): Promise<void> {
  if (!(await rebuild())) process.exitCode = 1;
}
