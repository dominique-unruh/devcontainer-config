#!/usr/bin/env node
// UserPromptSubmit hook: prepend a short standing reminder that the
// split-container workflow is in force, so the model routes work to the MCP
// tools from the first turn instead of having to be told.
//
// This is the only enforcement mechanism: nothing is actually blocked, so the
// wording is a directive, not a claim that the built-in tools are unavailable.
//
// SPLIT_CONTAINER_ENFORCE:
//   all  (default) - steer shell commands, and spell out the project-dir /
//                    outside-the-project-dir split for file operations
//   bash           - steer only shell commands, say nothing about files
//   off            - emit nothing

const mode = (process.env.SPLIT_CONTAINER_ENFORCE ?? "all").toLowerCase();
if (mode === "off") process.exit(0);

const fileToolNote =
  mode === "bash"
    ? ""
    : " For files, keep using the built-in Read/Write/Edit/Glob/Grep inside the project dir (it's shared with the container, so no approval is needed); use read_file/write_file/patch_file only for host files outside it.";

process.stdout.write(
  `[claude-split-container active] Prefer this plugin's MCP tools over the built-in Bash tool: ` +
    `use run_bash_container (free, no approval) whenever the task doesn't specifically require the ` +
    `host, and run_bash_host (human-approved, so keep commands simple and decomposed) when it ` +
    `does.${fileToolNote} Follow the split-container skill without being asked.`
);
