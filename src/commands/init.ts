import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  DEVCONTAINER_DIR,
  DEVCONTAINER_GITIGNORE,
  DEVCONTAINER_JSON,
  PROJECT_FEATURES_DIR,
} from "../lib/paths.js";
import { writeDevcontainerJson } from "../lib/devcontainerJson.js";
import { addFeatures } from "../lib/vendor.js";
import type { DevcontainerJson } from "../lib/types.js";

// Some features (e.g. claude) symlink container state they want to survive
// a rebuild into .devcontainer/persistent/ — it's on the host via the
// workspace bind mount, but still shouldn't be committed (it can hold
// tokens/credentials), so init keeps it out of git regardless of what the
// project's own top-level .gitignore does.
function ensurePersistentIgnored(): void {
  const existing = existsSync(DEVCONTAINER_GITIGNORE)
    ? readFileSync(DEVCONTAINER_GITIGNORE, "utf8")
    : "";
  if (existing.split("\n").some((line) => line.trim() === "persistent/")) return;
  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(DEVCONTAINER_GITIGNORE, `${existing}${separator}persistent/\n`);
}

export function cmdInit(): void {
  mkdirSync(DEVCONTAINER_DIR, { recursive: true });
  mkdirSync(PROJECT_FEATURES_DIR, { recursive: true });
  ensurePersistentIgnored();

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
