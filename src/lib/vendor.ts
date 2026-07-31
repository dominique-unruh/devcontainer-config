import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { PROJECT_FEATURES_DIR } from "./paths.js";
import { featureSourceDir, featureRefFor, readManifest, readMeta, readInstallSh } from "./featureSource.js";
import { buildHeaderLine, hashDirectory, hashFile, isManaged, withProvenanceHeader } from "./provenance.js";
import { sourceRemote } from "./git.js";
import { resolveDeps, type ResolvedDep } from "./deps.js";
import { readDevcontainerJson, writeDevcontainerJson, isFeatureInstalled, setFeatureOptions } from "./devcontainerJson.js";
import type { FeatureOptionSchema } from "./types.js";

export function projectFeatureDir(name: string): string {
  return path.join(PROJECT_FEATURES_DIR, name);
}

export function defaultOptions(schema: Record<string, FeatureOptionSchema>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, s] of Object.entries(schema)) {
    if (s.default !== undefined) out[key] = s.default;
  }
  return out;
}

function writeLocalFeatureFiles(name: string, srcDir: string, destDir: string): void {
  // Wipe + re-copy the whole feature directory (not just install.sh), so
  // a file removed from the source feature between revisions doesn't
  // linger in an updated vendored copy. Sibling scripts (e.g. a
  // postCreateCommand's configure.sh) are part of the devcontainer CLI's
  // build context for this feature, and meta.json's `tests` "custom"
  // scripts need to be present locally too, per the plan's "vendored into
  // the consuming project, not left in the source repo only" requirement.
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  cpSync(srcDir, destDir, { recursive: true });

  // Content hash is computed over the *source* dir, before any header is
  // injected — so a later check re-hashes current source and compares
  // like for like, independent of git history.
  const contentHash = hashDirectory(srcDir);
  const destInstallSh = path.join(destDir, "install.sh");
  const header = buildHeaderLine(sourceRemote(), `features/${name}`, contentHash);
  const installSh = withProvenanceHeader(readInstallSh(srcDir), header);
  writeFileSync(destInstallSh, installSh);
  chmodSync(destInstallSh, 0o755);
}

function writeExternalFeatureFiles(name: string, srcDir: string, destDir: string): void {
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });

  const srcMetaPath = path.join(srcDir, "meta.json");
  const contentHash = hashFile(srcMetaPath);
  const meta = readMeta(srcDir);
  meta.provenance = { remote: sourceRemote(), pathInRepo: `features/${name}/meta.json`, contentHash };
  writeFileSync(path.join(destDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");

  // Custom-validator scripts referenced by tests live alongside meta.json
  // in the source dir; vendor those too (external features have no other
  // files, so nothing else to copy).
  for (const test of meta.tests ?? []) {
    if (test.kind === "custom") {
      cpSync(path.join(srcDir, test.script), path.join(destDir, test.script));
    }
  }
}

function writeFeatureFiles(name: string, destDir: string): void {
  const srcDir = featureSourceDir(name);
  const meta = readMeta(srcDir);
  if (meta.external) writeExternalFeatureFiles(name, srcDir, destDir);
  else writeLocalFeatureFiles(name, srcDir, destDir);
}

// True if the destination is already vendored and stamped as ours —
// local features are stamped via install.sh's provenance comment,
// external features (no install.sh) via a `provenance` field written
// directly into their vendored meta.json.
function isManagedDestination(name: string, destDir: string): boolean {
  const meta = readMeta(featureSourceDir(name));
  if (meta.external) {
    if (!existsSync(path.join(destDir, "meta.json"))) return false;
    return readMeta(destDir).provenance !== undefined;
  }
  const destInstallSh = path.join(destDir, "install.sh");
  if (!existsSync(destInstallSh)) return false;
  return isManaged(readFileSync(destInstallSh, "utf8"));
}

function destinationExists(name: string, destDir: string): boolean {
  const meta = readMeta(featureSourceDir(name));
  return existsSync(path.join(destDir, meta.external ? "meta.json" : "install.sh"));
}

// Copies one feature's files into the project. Refuses to overwrite a
// destination that exists but isn't stamped as ours (mirrors
// vagrant-config.py add_one's managed-file check). Returns
// "already-present" (skip) rather than re-copying over an existing
// managed copy — `config`'s update flow (revendorFeature) is the
// deliberate path for refreshing an already-vendored feature.
export function vendorFeature(name: string): "copied" | "already-present" {
  const destDir = projectFeatureDir(name);

  if (destinationExists(name, destDir)) {
    if (!isManagedDestination(name, destDir)) {
      throw new Error(`${destDir} already exists and is not managed by devcontainer-config`);
    }
    return "already-present";
  }

  writeFeatureFiles(name, destDir);
  return "copied";
}

// Unconditionally re-copies a feature's files at the current source
// content, used by `config`'s/`update`'s update flow. Still refuses to
// touch a destination that exists but isn't stamped as ours.
export function revendorFeature(name: string): void {
  const destDir = projectFeatureDir(name);
  if (destinationExists(name, destDir) && !isManagedDestination(name, destDir)) {
    throw new Error(`${destDir} exists and is not managed by devcontainer-config`);
  }
  writeFeatureFiles(name, destDir);
}

export interface AddResult {
  resolved: ResolvedDep[];
  copied: string[];
  alreadyPresent: string[];
}

// Resolves `names` + transitive deps, vendors every one not already
// present, and wires each into devcontainer.json's "features" map (keyed
// by its external ref, or a local "./features/<name>" path) with its
// schema defaults — only for entries we're adding now; an
// already-installed feature's existing options are left untouched.
export function addFeatures(names: string[]): AddResult {
  const resolved = resolveDeps(names);
  const config = readDevcontainerJson();
  const copied: string[] = [];
  const alreadyPresent: string[] = [];

  for (const { name } of resolved) {
    const result = vendorFeature(name);
    if (result === "copied") copied.push(name);
    else alreadyPresent.push(name);

    const srcDir = featureSourceDir(name);
    const meta = readMeta(srcDir);
    const ref = featureRefFor(name, meta);
    if (!isFeatureInstalled(config, ref)) {
      const manifest = readManifest(srcDir, meta);
      setFeatureOptions(config, ref, defaultOptions(manifest.options));
    }
  }

  writeDevcontainerJson(config);
  return { resolved, copied, alreadyPresent };
}
