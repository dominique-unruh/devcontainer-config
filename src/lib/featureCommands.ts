import { installedFeatureDirNames } from "./tests.js";
import { projectFeatureDir } from "./vendor.js";
import { readMeta } from "./featureSource.js";

export interface FeatureCommand {
  name: string;
  help: string;
  shell: string;
  featureName: string;
}

// Names already claimed by cli.ts's own subcommands — builtins always
// win, so a feature declaring one of these is silently dropped rather
// than shadowing (or failing to register alongside) the real thing.
const RESERVED_NAMES = new Set(["init", "add", "config", "check", "update", "run", "stop"]);

// Feature-defined shortcuts (meta.json's `commands`) become their own
// top-level devcontainer-config subcommands — see FeatureCommandSpec.
// Only *installed* (vendored into this project) features contribute: a
// feature not added to the project has nothing meaningful to run inside
// its container.
export function collectFeatureCommands(): FeatureCommand[] {
  const out: FeatureCommand[] = [];
  const seen = new Set<string>();
  for (const featureName of installedFeatureDirNames()) {
    const meta = readMeta(projectFeatureDir(featureName));
    for (const [name, spec] of Object.entries(meta.commands ?? {})) {
      if (RESERVED_NAMES.has(name) || seen.has(name)) continue;
      if (typeof spec.shell !== "string") {
        // Collected unconditionally at CLI startup, before we know which
        // subcommand is being run — throwing here would block even
        // `update <featureName>`, the one command that could fix this.
        // Warn and skip instead; only actually invoking this command is
        // fatal (see cli.ts's registration loop).
        console.error(
          `warning: feature "${featureName}" command "${name}" has no "shell" string in its vendored meta.json` +
            ` — run \`devcontainer-config update ${featureName}\` to refresh it`,
        );
        continue;
      }
      seen.add(name);
      out.push({ name, help: spec.help, shell: spec.shell, featureName });
    }
  }
  return out;
}
