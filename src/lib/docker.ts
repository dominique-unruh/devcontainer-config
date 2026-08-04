import { spawn } from "node:child_process";

// Not vendored like DEVCONTAINER_BIN (see build.ts) — docker isn't an npm
// package, so it's resolved from PATH same as the devcontainer CLI itself
// defaults to.
export const DOCKER_BIN = "docker";

// Containers started by @devcontainers/cli are labelled with the resolved
// workspace folder path (see its own dist bundle), the same value
// `--workspace-folder .` resolves to for `up`/`exec` elsewhere in this repo
// — filtering on that label finds the right container without this tool
// tracking ids itself. `docker ps` (no -a) only lists *running* containers,
// so an empty result means "not running", whether that's because no
// container exists yet or because one exists but is stopped — both cases
// devcontainer CLI's own `exec` fails on, just with different error text
// (a missing container prints "Dev container not found."; a stopped one
// prints the docker daemon's "is not running", not caught by that string),
// so probing docker directly instead of matching exec's stderr covers both.
export function findRunningContainers(): Promise<string[]> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const child = spawn(DOCKER_BIN, ["ps", "--filter", `label=devcontainer.local_folder=${process.cwd()}`, "-q"], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("exit", () => {
      resolve(
        Buffer.concat(chunks)
          .toString("utf8")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      );
    });
  });
}
