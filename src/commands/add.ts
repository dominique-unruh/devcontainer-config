import { addFeatures } from "../lib/vendor.js";
import { featureDescription } from "../lib/featureSource.js";

export function cmdAdd(names: string[]): void {
  const result = addFeatures(names);

  for (const { name, requiredBy } of result.resolved) {
    if (!result.copied.includes(name)) continue;
    const suffix = requiredBy ? ` (required by ${requiredBy})` : "";
    console.log(`added ${name}: ${featureDescription(name)}${suffix}`);
  }
  for (const name of result.alreadyPresent) {
    console.log(`${name}: already present, skipped`);
  }
}
