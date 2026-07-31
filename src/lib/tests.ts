import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PROJECT_FEATURES_DIR } from "./paths.js";
import { projectFeatureDir } from "./vendor.js";
import { readManifest, readMeta, featureRefFor } from "./featureSource.js";
import { readDevcontainerJson, getFeatureOptions, isFeatureInstalled } from "./devcontainerJson.js";
import type { CustomValidator, DevcontainerJson, TestResult, TestSpec } from "./types.js";

export function installedFeatureDirNames(): string[] {
  if (!existsSync(PROJECT_FEATURES_DIR)) return [];
  return readdirSync(PROJECT_FEATURES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

// Resolves a *tracked* feature name (one we vendor a meta.json for,
// local or external) to whether its devcontainer.json entry is present —
// not vendored at all locally means "not installed" without error.
function isTrackedFeatureInstalled(config: DevcontainerJson, name: string): boolean {
  const dir = projectFeatureDir(name);
  if (!existsSync(dir)) return false;
  return isFeatureInstalled(config, featureRefFor(name, readMeta(dir)));
}

function effectiveOptions(config: DevcontainerJson, name: string): Record<string, unknown> {
  const dir = projectFeatureDir(name);
  if (!existsSync(dir)) return {};
  const meta = readMeta(dir);
  const manifest = readManifest(dir, meta);
  const defaults: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(manifest.options)) {
    if (schema.default !== undefined) defaults[key] = schema.default;
  }
  return { ...defaults, ...getFeatureOptions(config, featureRefFor(name, meta)) };
}

async function runOne(featureName: string, test: TestSpec, config: DevcontainerJson): Promise<TestResult> {
  switch (test.kind) {
    case "incompatibleWith": {
      const pass = !isTrackedFeatureInstalled(config, test.feature);
      return {
        featureName,
        test,
        pass,
        message: pass ? undefined : test.message ?? `${featureName} is incompatible with installed feature ${test.feature}`,
      };
    }
    case "dependsOnOptions": {
      if (!isTrackedFeatureInstalled(config, test.feature)) {
        // Dependency not installed at all is a deps-resolution bug, not
        // this test's concern — treat as pass, `add`'s dep walk owns it.
        return { featureName, test, pass: true };
      }
      const effective = effectiveOptions(config, test.feature);
      const mismatches = Object.entries(test.options).filter(([k, v]) => effective[k] !== v);
      const pass = mismatches.length === 0;
      return {
        featureName,
        test,
        pass,
        message: pass
          ? undefined
          : test.message ??
            `${featureName} requires ${test.feature} options ${JSON.stringify(test.options)}, ` +
              `but found ${JSON.stringify(Object.fromEntries(mismatches.map(([k]) => [k, effective[k]])))}`,
      };
    }
    case "custom": {
      const scriptPath = path.join(projectFeatureDir(featureName), test.script);
      const mod = (await import(pathToFileURL(scriptPath).href)) as { default: CustomValidator };
      const result = await mod.default(config);
      return { featureName, test, pass: result.pass, message: result.message ?? test.message };
    }
  }
}

// Runs every test declared by every installed feature's vendored
// meta.json against the current devcontainer.json — a change to one
// feature's options can break another feature's test, so this is always
// a full sweep, never scoped to a single feature.
export async function runAllTests(): Promise<TestResult[]> {
  const config = readDevcontainerJson();
  const results: TestResult[] = [];
  for (const name of installedFeatureDirNames()) {
    const meta = readMeta(projectFeatureDir(name));
    for (const test of meta.tests ?? []) {
      results.push(await runOne(name, test, config));
    }
  }
  return results;
}

export function reportTestResults(results: TestResult[]): boolean {
  const failures = results.filter((r) => !r.pass);
  if (failures.length === 0) {
    console.log(`tests: ${results.length} passed`);
    return true;
  }
  console.log(`tests: ${failures.length}/${results.length} failed`);
  for (const f of failures) {
    console.log(`  FAIL [${f.featureName}] ${f.test.kind}: ${f.message ?? "(no message)"}`);
  }
  return false;
}
