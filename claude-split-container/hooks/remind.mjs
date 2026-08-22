#!/usr/bin/env node
// SessionStart hook: state the split-container workflow once, at the start of
// the session, so the model routes work to the MCP tools without having to be
// told and without waiting to load the skill.
//
// Deliberately SessionStart rather than UserPromptSubmit: the latter fires on
// every user prompt and its text stays in the transcript, so the same ~170
// tokens would be re-added each turn. Once per session costs that once.
//
// IMPORTANT: emit JSON with hookSpecificOutput.additionalContext. Plain stdout
// is accepted by Claude Code ("Hook output does not start with {, treating as
// plain text") and reported as a successful run, but for some hook events it is
// not injected into the model's context — a plain-text version of this hook
// silently did nothing at all. JSON is unambiguous, so use it.
//
// Nothing is actually blocked; this is steering, not enforcement.
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

const additionalContext =
  `[claude-split-container active for this session] Do not use the built-in Bash tool. Run shell ` +
  `commands with this plugin's MCP tools instead: run_bash_container (free, no approval) whenever ` +
  `the task doesn't specifically require the host, and run_bash_host (human-approved, so keep ` +
  `commands simple and decomposed) when it does.${fileToolNote} This holds for the whole session, ` +
  `including later turns — apply it without being asked and without loading the split-container ` +
  `skill first; consult that skill for the fuller rationale.`;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext,
    },
  })
);
