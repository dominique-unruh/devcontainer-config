import { spawn } from "node:child_process";
import path from "node:path";
import prompts from "prompts";
import { REPO_DIR } from "./paths.js";

// @devcontainers/cli is --packages=external (see package.json's build
// script), so it's resolved from node_modules at runtime like
// commander/prompts, not inlined into dist/devcontainer-config — the
// binary always lives under this repo's own node_modules/.bin regardless
// of the current project's PATH.
const DEVCONTAINER_BIN = path.join(REPO_DIR, "node_modules", ".bin", "devcontainer");

// Commands mark this when they mutate the project's devcontainer config,
// instead of building themselves — cli.ts checks it once after the command
// finishes, so a build runs at most once per process regardless of how
// many mutating steps a command went through (e.g. cmdConfig calling
// cmdAdd internally).
let buildNeeded = false;

export function markBuildNeeded(): void {
  buildNeeded = true;
}

function runDevcontainerBuild(): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const child = spawn(DEVCONTAINER_BIN, ["build", "--workspace-folder", "."], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.on("error", (err) => {
      chunks.push(Buffer.from(`error: failed to run devcontainer build: ${err instanceof Error ? err.message : String(err)}\n`));
      resolve({ ok: false, output: Buffer.concat(chunks).toString("utf8") });
    });
    child.on("exit", (code) => resolve({ ok: code === 0, output: Buffer.concat(chunks).toString("utf8") }));
  });
}

// Called once, at the very end of the overall CLI invocation. No-op unless
// some command marked a mutation via markBuildNeeded(). Confirms with the
// user first (a build is slow), and swallows the devcontainer CLI's own
// output unless the build fails — a passing build isn't interesting, a
// failing one needs the log to debug.
export async function buildIfNeeded(): Promise<boolean> {
  if (!buildNeeded) return true;

  const { confirmed } = await prompts({
    type: "confirm",
    name: "confirmed",
    message: "Build devcontainer now to verify?",
    initial: true,
  });
  if (!confirmed) return true;

  const { ok, output } = await runDevcontainerBuild();
  if (!ok) {
    process.stdout.write(output);
    console.error("error: devcontainer build failed");
  }
  return ok;
}
