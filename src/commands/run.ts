import { spawn } from "node:child_process";
import { DEVCONTAINER_BIN, WORKSPACE_ARGS, discardFailedContainer } from "../lib/build.js";
import { findRunningContainers, preflightDocker } from "../lib/docker.js";
import { readDevcontainerJson } from "../lib/devcontainerJson.js";
import { checkMarkers } from "../lib/markers.js";

function runUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(DEVCONTAINER_BIN, ["up", ...WORKSPACE_ARGS], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code === 0));
  });
}

// The real invocation, run only once we know (or have just ensured) the
// container is up — full stdio inherit so interactive commands and TTY
// output behave exactly like a direct `devcontainer exec` would.
function execInherit(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(DEVCONTAINER_BIN, ["exec", ...WORKSPACE_ARGS, ...args], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

export async function cmdRun(args: string[]): Promise<void> {
  const dockerErr = await preflightDocker();
  if (dockerErr) {
    console.error(`error: ${dockerErr}`);
    process.exitCode = 1;
    return;
  }

  const running = await findRunningContainers();
  if (running.length === 0) {
    console.log("devcontainer not running, starting it...");
    if (!(await runUp())) {
      console.error("error: devcontainer up failed");
      await discardFailedContainer();
      process.exitCode = 1;
      return;
    }
  }

  // Catches a container whose setup failed outside this process (started
  // by VS Code, the claude-split-container plugin, an interrupted rebuild)
  // — `up` on an already-created container never re-runs a failed
  // create-time command, so its exit code alone can't tell.
  const config = readDevcontainerJson();
  const [containerId] = await findRunningContainers();
  let problem = containerId ? await checkMarkers(config, containerId) : null;

  // Only the postStart marker is stale/missing: the container was most
  // likely (re)started outside the devcontainer CLI (e.g. `docker restart`),
  // so its postStartCommands never ran this start. `up` on a running
  // container runs them now — unlike create-time commands, which `up`
  // never retries, hence no such recovery for a postCreate problem.
  if (problem?.phase === "postStartCommand" && containerId) {
    console.warn("warning: the container's postStartCommand has not completed for its current start; running devcontainer up...");
    if (!(await runUp())) {
      console.error("error: devcontainer up failed");
      await discardFailedContainer();
      process.exitCode = 1;
      return;
    }
    problem = await checkMarkers(config, containerId);
  }

  if (problem) {
    console.error(`error: ${problem.message} — run 'devcontainer-config rebuild'`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = await execInherit(args);
}
