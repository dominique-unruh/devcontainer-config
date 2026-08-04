import { Command } from "commander";
import { cmdInit } from "./commands/init.js";
import { cmdAdd } from "./commands/add.js";
import { cmdConfig } from "./commands/config.js";
import { cmdCheck } from "./commands/check.js";
import { cmdUpdate } from "./commands/update.js";
import { cmdRun } from "./commands/run.js";
import { cmdStop } from "./commands/stop.js";
import { listFeatureNames, featureDescription } from "./lib/featureSource.js";
import { buildIfNeeded } from "./lib/build.js";
import { tryHandleCompletion, type CompletionSpec } from "./lib/completion.js";

tryHandleCompletion(
  {
    subcommands: [
      { name: "init", positionals: "none" },
      { name: "add", positionals: "variadic" },
      { name: "config", positionals: "single" },
      { name: "check", positionals: "none" },
      { name: "update", options: ["--all"], positionals: "variadic" },
      { name: "run", positionals: "none" },
      { name: "stop", positionals: "none" },
    ],
  } satisfies CompletionSpec,
  listFeatureNames,
);

const program = new Command();
program
  .name("devcontainer-config")
  .description("Scaffold and vendor composable devcontainer Features into a project.")
  .enablePositionalOptions();

program
  .command("init")
  .description("scaffold a devcontainer.json and .devcontainer/features/ in the current directory")
  .action(() => cmdInit());

program
  .command("add")
  .description("vendor feature(s) into ./.devcontainer/features/")
  .argument("<names...>", "feature name(s)")
  .addHelpText(
    "after",
    () => "\navailable features:\n" + listFeatureNames().map((n) => `  ${n}: ${featureDescription(n)}`).join("\n"),
  )
  .action((names: string[]) => cmdAdd(names));

program
  .command("config")
  .description("interactively edit a feature's options; auto-adds it if missing; checks for updates")
  .argument("[name]", "feature name (omit to pick from a list)")
  .action((name?: string) => cmdConfig(name));

program
  .command("check")
  .description("run all installed features' tests non-interactively; exits non-zero on failure")
  .action(() => cmdCheck());

program
  .command("update")
  .description("update installed features to the current source revision")
  .argument("[names...]", "feature name(s) to update (omit for an interactive picker over updateable features)")
  .option("--all", "update every installed feature")
  .action((names: string[], opts: { all?: boolean }) => cmdUpdate(names, opts));

program
  .command("run")
  .description("run `devcontainer exec <args...>`, starting the devcontainer first if it isn't up yet")
  .argument("<args...>", "command and arguments to run inside the devcontainer")
  .allowUnknownOption()
  .passThroughOptions()
  .action((args: string[]) => cmdRun(args));

program
  .command("stop")
  .description("shut down the running devcontainer (docker stop), no-op if not running")
  .action(() => cmdStop());

try {
  await program.parseAsync();
  if (!(await buildIfNeeded())) process.exitCode = 1;
} catch (err) {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
