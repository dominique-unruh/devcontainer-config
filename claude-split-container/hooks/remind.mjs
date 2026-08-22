#!/usr/bin/env node
// UserPromptSubmit hook: prepend a short standing reminder that the
// split-container workflow is in force, so the model routes work to the MCP
// tools from the first turn instead of having to be told, or having to discover
// it by getting denied.
//
// Disabled along with everything else by SPLIT_CONTAINER_ENFORCE=off.

if ((process.env.SPLIT_CONTAINER_ENFORCE ?? "all").toLowerCase() === "off") {
  process.exit(0);
}

const mode = (process.env.SPLIT_CONTAINER_ENFORCE ?? "all").toLowerCase();

const fileToolNote =
  mode === "bash"
    ? ""
    : " The built-in Read/Write/Edit/Glob/Grep tools are disabled too — use container commands for files in the project dir (it's shared with the container), and read_file/write_file/patch_file for host files outside it.";

process.stdout.write(
  `[claude-split-container active] Built-in Bash is disabled. Run commands with the ` +
    `run_bash_container MCP tool (free, no approval) whenever the task doesn't specifically require ` +
    `the host, and run_bash_host (human-approved, so keep commands simple and decomposed) only when ` +
    `it does.${fileToolNote} Follow the split-container skill without being asked.`
);
