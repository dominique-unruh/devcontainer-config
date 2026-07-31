import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveDeps } from "./deps.js";
import { hashDirectory, hashFile, parseProvenance } from "./provenance.js";
import { featureSourceDir, readMeta } from "./featureSource.js";
import { projectFeatureDir, revendorFeature } from "./vendor.js";
import { installedFeatureDirNames } from "./tests.js";

export interface UpdateInfo {
  name: string;
  oldHash?: string;
  newHash: string;
  isNew: boolean;
}

// Current source content hash for `name` — a directory hash for local
// features (install.sh + siblings), or a file hash of meta.json for
// external ones (their only source-of-truth file).
function currentSourceHash(name: string): string {
  const srcDir = featureSourceDir(name);
  const meta = readMeta(srcDir);
  return meta.external ? hashFile(path.join(srcDir, "meta.json")) : hashDirectory(srcDir);
}

// The hash recorded in a feature's *vendored* copy at the time it was
// last vendored — from meta.json's `provenance` field (external, no
// install.sh to stamp) or install.sh's provenance comment (local).
function vendoredHash(name: string): string | undefined {
  const dir = projectFeatureDir(name);
  const meta = readMeta(dir);
  if (meta.provenance) return meta.provenance.contentHash;
  const installShPath = path.join(dir, "install.sh");
  if (!existsSync(installShPath)) return undefined;
  return parseProvenance(readFileSync(installShPath, "utf8"))?.contentHash;
}

// Checks `names` and all of their transitive deps combined (per the
// *current* source repo's meta.json, in case deps changed since last
// vendored) against the content hash recorded when each was vendored.
export function checkUpdates(names: string[]): UpdateInfo[] {
  const resolved = resolveDeps(names);
  const out: UpdateInfo[] = [];

  for (const { name } of resolved) {
    const newHash = currentSourceHash(name);
    if (!existsSync(projectFeatureDir(name))) {
      out.push({ name, newHash, isNew: true });
      continue;
    }
    const oldHash = vendoredHash(name);
    if (oldHash !== newHash) {
      out.push({ name, oldHash, newHash, isNew: false });
    }
  }
  return out;
}

// Every currently-installed feature whose own vendored content hash is
// behind the source repo's — used to build the interactive picker when
// `update` is run with no arguments. Not dep-transitive (unlike
// checkUpdates): just "is this particular installed feature itself stale".
export function listStaleInstalledFeatures(): UpdateInfo[] {
  const out: UpdateInfo[] = [];
  for (const name of installedFeatureDirNames()) {
    const newHash = currentSourceHash(name);
    const oldHash = vendoredHash(name);
    if (oldHash !== newHash) {
      out.push({ name, oldHash, newHash, isNew: false });
    }
  }
  return out;
}

export function applyUpdates(infos: UpdateInfo[]): void {
  for (const info of infos) revendorFeature(info.name);
}
