import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { DevcontainerJson } from "./types.js";
import { DEVCONTAINER_JSON } from "./paths.js";

export function devcontainerJsonExists(): boolean {
  return existsSync(DEVCONTAINER_JSON);
}

export function readDevcontainerJson(): DevcontainerJson {
  if (!existsSync(DEVCONTAINER_JSON)) {
    throw new Error(`${DEVCONTAINER_JSON} not found — run 'devcontainer-config init' first`);
  }
  return JSON.parse(readFileSync(DEVCONTAINER_JSON, "utf8"));
}

export function writeDevcontainerJson(config: DevcontainerJson): void {
  writeFileSync(DEVCONTAINER_JSON, JSON.stringify(config, null, 2) + "\n");
}

// All of these take the devcontainer.json features-map *key* directly
// (a local "./features/<name>" path or an external OCI ref) rather than
// our internal short name — callers compute the right key via
// featureSource.ts's featureRefFor(name, meta), since which one applies
// depends on whether the feature is local or external.

export function isFeatureInstalled(config: DevcontainerJson, ref: string): boolean {
  return Boolean(config.features && ref in config.features);
}

export function setFeatureOptions(config: DevcontainerJson, ref: string, options: Record<string, unknown>): void {
  config.features ??= {};
  config.features[ref] = options;
}

export function getFeatureOptions(config: DevcontainerJson, ref: string): Record<string, unknown> {
  return config.features?.[ref] ?? {};
}

export function removeFeature(config: DevcontainerJson, ref: string): void {
  if (config.features) delete config.features[ref];
}
