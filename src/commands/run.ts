import { spawn } from "node:child_process";
import { DEVCONTAINER_BIN } from "../lib/build.js";
import { findRunningContainers, preflightDocker } from "../lib/docker.js";

function runUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(DEVCONTAINER_BIN, ["up", "--workspace-folder", "."], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code === 0));
  });
}

// The real invocation, run only once we know (or have just ensured) the
// container is up — full stdio inherit so interactive commands and TTY
// output behave exactly like a direct `devcontainer exec` would.
function execInherit(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(DEVCONTAINER_BIN, ["exec", "--workspace-folder", ".", ...args], { stdio: "inherit" });
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
      process.exitCode = 1;
      return;
    }
  }

  process.exitCode = await execInherit(args);
}
