import { spawn } from "node:child_process";

// Not vendored like DEVCONTAINER_BIN (see build.ts) — docker isn't an npm
// package, so it's resolved from PATH same as the devcontainer CLI itself
// defaults to.
export const DOCKER_BIN = "docker";

// Preflight before any command shells out to docker — directly (findRunning-
// Containers, `docker stop`) or transitively via the devcontainer CLI, which
// spawns docker itself and only surfaces a cryptic "spawn docker ENOENT" when
// it's missing. `docker version --format {{.Server.Version}}` exits 0 only
// when the binary is present AND the daemon is reachable, so one probe covers
// both failure modes. Returns null when ready, else a human-readable reason.
export function preflightDocker(): Promise<string | null> {
  return new Promise((resolve) => {
    const stderr: Buffer[] = [];
    const child = spawn(DOCKER_BIN, ["version", "--format", "{{.Server.Version}}"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr?.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (err: NodeJS.ErrnoException) => {
      resolve(
        err.code === "ENOENT"
          ? "docker not found on PATH — install Docker (https://docs.docker.com/get-docker/) and make sure `docker` is on your PATH."
          : `could not run docker: ${err.message}`,
      );
    });
    child.on("exit", (code) => {
      if (code === 0) return resolve(null);
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      resolve(`docker is installed but not usable — is the daemon running?${detail ? `\n${detail}` : ""}`);
    });
  });
}

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
    // Never let a spawn failure (e.g. docker not on PATH) emit an unhandled
    // 'error' event that would crash the process — treat it as "none found".
    // Callers preflight docker first, so this only fires on a race/edge case.
    child.on("error", () => resolve([]));
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
