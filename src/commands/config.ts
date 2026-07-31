import { existsSync, rmSync } from "node:fs";
import prompts from "prompts";
import { listFeatureNames, featureDescription, readManifest, readMeta, featureRefFor } from "../lib/featureSource.js";
import { projectFeatureDir, addFeatures } from "../lib/vendor.js";
import { installedFeatureDirNames, runAllTests, reportTestResults } from "../lib/tests.js";
import { checkUpdates, applyUpdates, type UpdateInfo } from "../lib/update.js";
import {
  readDevcontainerJson,
  writeDevcontainerJson,
  getFeatureOptions,
  setFeatureOptions,
  removeFeature,
} from "../lib/devcontainerJson.js";
import { cmdAdd } from "./add.js";

function isVendored(name: string): boolean {
  return existsSync(projectFeatureDir(name));
}

function short(hash: string | undefined): string {
  return hash ? hash.slice(0, 12) : "(none)";
}

function describeUpdate(info: UpdateInfo): string {
  return info.isNew ? `${info.name}: not vendored yet -> ${short(info.newHash)}` : `${info.name}: ${short(info.oldHash)} -> ${short(info.newHash)}`;
}

async function pickFeature(): Promise<string | undefined> {
  const installed = new Set(installedFeatureDirNames());
  const names = [...listFeatureNames()].sort((a, b) => {
    const installedDiff = Number(installed.has(b)) - Number(installed.has(a));
    return installedDiff !== 0 ? installedDiff : a.localeCompare(b);
  });
  const choices = names.map((name) => ({
    title: `${installed.has(name) ? "[installed] " : ""}${name}`,
    description: featureDescription(name),
    value: name,
  }));
  const { name } = await prompts({
    type: "select",
    name: "name",
    message: "Which feature?",
    choices,
  });
  return name as string | undefined;
}

async function runTestSweep(): Promise<void> {
  reportTestResults(await runAllTests());
}

async function editOptions(name: string): Promise<boolean> {
  const dir = projectFeatureDir(name);
  const meta = readMeta(dir);
  const manifest = readManifest(dir, meta);
  const optionEntries = Object.entries(manifest.options);
  if (optionEntries.length === 0) {
    console.log(`${name} has no options to configure.`);
    return false;
  }

  const ref = featureRefFor(name, meta);
  const config = readDevcontainerJson();
  const current = getFeatureOptions(config, ref);
  const next: Record<string, unknown> = { ...current };

  for (const [key, schema] of optionEntries) {
    const initial = current[key] ?? schema.default;
    if (schema.type === "boolean") {
      const { value } = await prompts({
        type: "toggle",
        name: "value",
        message: schema.description ?? key,
        initial: Boolean(initial),
        active: "yes",
        inactive: "no",
      });
      if (value === undefined) return false; // cancelled
      next[key] = value;
    } else if (schema.enum) {
      const { value } = await prompts({
        type: "select",
        name: "value",
        message: schema.description ?? key,
        choices: schema.enum.map((v) => ({ title: v, value: v })),
        initial: Math.max(0, schema.enum.indexOf(String(initial))),
      });
      if (value === undefined) return false;
      next[key] = value;
    } else {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: schema.description ?? key,
        initial: initial !== undefined ? String(initial) : "",
      });
      if (value === undefined) return false;
      next[key] = value;
    }
  }

  setFeatureOptions(config, ref, next);
  writeDevcontainerJson(config);
  console.log(`updated options for ${name}`);
  return true;
}

async function checkAndApplyUpdates(name: string): Promise<boolean> {
  const infos = checkUpdates([name]);
  if (infos.length === 0) {
    console.log(`${name} and its dependencies are up to date.`);
    return false;
  }

  console.log("updates available:");
  for (const info of infos) console.log(`  ${describeUpdate(info)}`);

  const { confirmed } = await prompts({
    type: "confirm",
    name: "confirmed",
    message: `Update ${infos.length} feature(s)?`,
    initial: true,
  });
  if (!confirmed) return false;

  applyUpdates(infos);
  console.log("updated.");
  return true;
}

async function deleteFeature(name: string): Promise<boolean> {
  const dependents = installedFeatureDirNames().filter((other) => {
    if (other === name) return false;
    return (readMeta(projectFeatureDir(other)).deps ?? []).includes(name);
  });

  if (dependents.length > 0) {
    console.log(`warning: still required by: ${dependents.join(", ")}`);
  }

  const { confirmed } = await prompts({
    type: "confirm",
    name: "confirmed",
    message: dependents.length > 0 ? `Delete ${name} anyway? This will break its dependents' next build.` : `Delete ${name}?`,
    initial: false,
  });
  if (!confirmed) return false;

  const dir = projectFeatureDir(name);
  const ref = featureRefFor(name, readMeta(dir));
  rmSync(dir, { recursive: true, force: true });
  const config = readDevcontainerJson();
  removeFeature(config, ref);
  writeDevcontainerJson(config);
  console.log(`deleted ${name}`);
  return true;
}

export async function cmdConfig(nameArg?: string): Promise<void> {
  console.log("Running full test sweep...");
  await runTestSweep();

  const name = nameArg ?? (await pickFeature());
  if (!name) return;

  if (!isVendored(name)) {
    console.log(`${name} isn't vendored yet, adding it (and its dependencies)...`);
    cmdAdd([name]);
    await runTestSweep();
  }

  for (;;) {
    const { action } = await prompts({
      type: "select",
      name: "action",
      message: `${name}`,
      choices: [
        { title: "Edit options", value: "edit" },
        { title: "Check for updates", value: "update" },
        { title: "Delete", value: "delete" },
        { title: "Done", value: "done" },
      ],
    });

    if (!action || action === "done") return;

    let mutated = false;
    if (action === "edit") mutated = await editOptions(name);
    else if (action === "update") mutated = await checkAndApplyUpdates(name);
    else if (action === "delete") {
      mutated = await deleteFeature(name);
      if (mutated) {
        await runTestSweep();
        return;
      }
    }

    if (mutated) await runTestSweep();
  }
}
