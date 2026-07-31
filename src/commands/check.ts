import { runAllTests, reportTestResults } from "../lib/tests.js";

// Same full sweep `config` runs on startup/after mutations, but as its
// own non-interactive subcommand — for CI, pre-commit hooks, etc.
export async function cmdCheck(): Promise<void> {
  const ok = reportTestResults(await runAllTests());
  if (!ok) process.exitCode = 1;
}
