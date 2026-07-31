import prompts from "prompts";
import { checkUpdates, applyUpdates, listStaleInstalledFeatures, type UpdateInfo } from "../lib/update.js";
import { installedFeatureDirNames, runAllTests, reportTestResults } from "../lib/tests.js";

function short(hash: string | undefined): string {
  return hash ? hash.slice(0, 12) : "(none)";
}

function describe(info: UpdateInfo): string {
  return info.isNew ? `${info.name}: not vendored yet -> ${short(info.newHash)}` : `${info.name}: ${short(info.oldHash)} -> ${short(info.newHash)}`;
}

export async function cmdUpdate(names: string[], opts: { all?: boolean }): Promise<void> {
  let targets: string[];

  if (opts.all) {
    targets = installedFeatureDirNames();
  } else if (names.length > 0) {
    targets = names;
  } else {
    const stale = listStaleInstalledFeatures();
    if (stale.length === 0) {
      console.log("everything is up to date.");
      return;
    }
    const { picked } = await prompts({
      type: "multiselect",
      name: "picked",
      message: "Select features to update",
      choices: stale.map((s) => ({ title: describe(s), value: s.name, selected: true })),
    });
    if (!picked || picked.length === 0) return;
    targets = picked;
  }

  // Combined transitive check across all targets — an explicitly-named
  // feature that's already current can still pull in a stale dependency.
  const infos = checkUpdates(targets);
  if (infos.length === 0) {
    console.log("up to date.");
    return;
  }

  console.log(`updating ${infos.length} feature(s):`);
  for (const info of infos) console.log(`  ${describe(info)}`);
  applyUpdates(infos);

  console.log("Running full test sweep...");
  reportTestResults(await runAllTests());
}
