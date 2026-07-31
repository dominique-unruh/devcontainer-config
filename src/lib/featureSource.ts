import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { SOURCE_FEATURES_DIR } from "./paths.js";
import type { DevcontainerFeatureJson, FeatureMeta, FeatureOptionSchema } from "./types.js";

export function listFeatureNames(): string[] {
  return readdirSync(SOURCE_FEATURES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

// A feature dir is valid either as a local feature (has
// devcontainer-feature.json + install.sh) or an external one (meta.json's
// `external` is set, referencing a public/OCI feature we don't own).
export function featureSourceDir(name: string): string {
  const dir = path.join(SOURCE_FEATURES_DIR, name);
  const hasLocal = existsSync(path.join(dir, "devcontainer-feature.json"));
  const hasExternal = readMeta(dir).external !== undefined;
  if (!hasLocal && !hasExternal) {
    throw new Error(`no such feature: ${name}`);
  }
  return dir;
}

export function isExternal(meta: FeatureMeta): boolean {
  return meta.external !== undefined;
}

// devcontainer.json features-map key for a tracked feature: the external
// ref if it has one, otherwise our own local relativePath convention.
export function featureRefFor(name: string, meta: FeatureMeta): string {
  return meta.external?.ref ?? `./features/${name}`;
}

export function readFeatureJson(featureDir: string): DevcontainerFeatureJson {
  return JSON.parse(readFileSync(path.join(featureDir, "devcontainer-feature.json"), "utf8"));
}

export function readMeta(featureDir: string): FeatureMeta {
  const metaPath = path.join(featureDir, "meta.json");
  if (!existsSync(metaPath)) return {};
  return JSON.parse(readFileSync(metaPath, "utf8"));
}

export function readInstallSh(featureDir: string): string {
  return readFileSync(path.join(featureDir, "install.sh"), "utf8");
}

export interface FeatureManifest {
  description: string;
  options: Record<string, FeatureOptionSchema>;
}

// Unified view of "what can be configured / described about this
// feature", regardless of whether it's local (read from its
// devcontainer-feature.json) or external (read from meta.json's
// `external.description`/`external.options`, since there's no local
// devcontainer-feature.json to read for those).
export function readManifest(featureDir: string, meta: FeatureMeta): FeatureManifest {
  if (meta.external) {
    return { description: meta.external.description ?? "", options: meta.external.options ?? {} };
  }
  const featureJson = readFeatureJson(featureDir);
  return { description: featureJson.description ?? "", options: featureJson.options ?? {} };
}

export function featureDescription(name: string): string {
  try {
    const dir = featureSourceDir(name);
    return readManifest(dir, readMeta(dir)).description;
  } catch {
    return "";
  }
}
