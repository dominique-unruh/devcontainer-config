import path from "node:path";
import { pathToFileURL } from "node:url";
import { readMeta } from "./featureSource.js";
import { readDevcontainerJson } from "./devcontainerJson.js";
import { installedFeatureDirNames } from "./tests.js";
import { projectFeatureDir } from "./vendor.js";
import type { CustomValidator } from "./types.js";

// Runs every installed feature's meta.json `beforeUp` script on the host —
// called right before each `devcontainer up` (rebuild, and run's own
// startup). Scripts share the "custom" test signature, so one script can
// serve both roles; a returned {pass: false} is printed as a warning but
// doesn't stop the build (the feature itself decides how to cope).
export async function runBeforeUpHooks(): Promise<void> {
  const config = readDevcontainerJson();
  for (const name of installedFeatureDirNames()) {
    const dir = projectFeatureDir(name);
    const script = readMeta(dir).beforeUp;
    if (!script) continue;
    const mod = (await import(pathToFileURL(path.join(dir, script)).href)) as { default: CustomValidator };
    const result = await mod.default(config);
    if (!result.pass) console.warn(`warning: [${name}] beforeUp: ${result.message ?? "(no message)"}`);
  }
}
