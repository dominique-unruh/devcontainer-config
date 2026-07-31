import { addFeatures } from "../lib/vendor.js";
import { featureDescription } from "../lib/featureSource.js";
import { markBuildNeeded } from "../lib/build.js";

export async function cmdAdd(names: string[]): Promise<void> {
  const result = addFeatures(names);

  for (const { name, requiredBy } of result.resolved) {
    if (!result.copied.includes(name)) continue;
    const suffix = requiredBy ? ` (required by ${requiredBy})` : "";
    console.log(`added ${name}: ${featureDescription(name)}${suffix}`);
  }
  for (const name of result.alreadyPresent) {
    console.log(`${name}: already present, skipped`);
  }

  if (result.copied.length > 0) markBuildNeeded();
}
