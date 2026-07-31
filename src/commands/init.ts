import { existsSync, mkdirSync } from "node:fs";
import { DEVCONTAINER_DIR, DEVCONTAINER_JSON, PROJECT_FEATURES_DIR } from "../lib/paths.js";
import { writeDevcontainerJson } from "../lib/devcontainerJson.js";
import { addFeatures } from "../lib/vendor.js";
import type { DevcontainerJson } from "../lib/types.js";

export function cmdInit(): void {
  mkdirSync(DEVCONTAINER_DIR, { recursive: true });
  mkdirSync(PROJECT_FEATURES_DIR, { recursive: true });

  if (existsSync(DEVCONTAINER_JSON)) {
    console.warn(`warning: ${DEVCONTAINER_JSON} already exists, not overwriting`);
  } else {
    const config: DevcontainerJson = {
      image: "ubuntu:24.04",
      remoteUser: "dev",
      features: {},
    };
    writeDevcontainerJson(config);
    console.log(`created ${DEVCONTAINER_JSON}`);
  }

  // Plain ubuntu:24.04 ships no non-root user (unlike
  // mcr.microsoft.com/devcontainers/base:ubuntu) — "user" is the one
  // feature every project needs, so init wires it in directly.
  const result = addFeatures(["user"]);
  for (const name of result.copied) {
    console.log(`added ${name}`);
  }
}
