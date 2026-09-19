import { spawn } from "node:child_process";
import { DOCKER_BIN, findRunningContainers, preflightDocker } from "../lib/docker.js";

function dockerStop(ids: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(DOCKER_BIN, ["stop", ...ids], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code === 0));
  });
}

export async function cmdStop(): Promise<void> {
  const dockerErr = await preflightDocker();
  if (dockerErr) {
    console.error(`error: ${dockerErr}`);
    process.exitCode = 1;
    return;
  }

  const ids = await findRunningContainers();
  if (ids.length === 0) {
    console.log("devcontainer not running");
    return;
  }

  if (!(await dockerStop(ids))) {
    console.error("error: docker stop failed");
    process.exitCode = 1;
  }
}
