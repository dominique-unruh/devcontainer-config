import { addFeatures } from "../lib/vendor.js";
import { featureDescription } from "../lib/featureSource.js";
import { markBuildNeeded } from "../lib/build.js";
import { runAllTests, reportTestResults } from "../lib/tests.js";

// runTests: false for callers that run their own sweep afterwards (config).
export async function cmdAdd(names: string[], { runTests = true } = {}): Promise<void> {
  const result = addFeatures(names);

  for (const { name, requiredBy } of result.resolved) {
    if (!result.copied.includes(name)) continue;
    const suffix = requiredBy ? ` (required by ${requiredBy})` : "";
    console.log(`added ${name}: ${featureDescription(name)}${suffix}`);
  }
  for (const name of result.alreadyPresent) {
    console.log(`${name}: already present, skipped`);
  }

  if (runTests) {
    console.log("Running full test sweep...");
    if (!reportTestResults(await runAllTests())) process.exitCode = 1;
  }

  if (result.copied.length > 0) markBuildNeeded();
}
