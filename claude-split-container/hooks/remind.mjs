#!/usr/bin/env node
// SessionStart hook: state the split-container routing once, at the start of the
// session, so the model defaults shell work to run_bash_container without having
// to be told. Kept minimal on purpose: it mirrors the gate-bash deny message and
// points at the split-container skill for the host/container decision and the
// unlock syntax, rather than duplicating that guidance here. Forcing the skill to
// be the single source of the host-command details is deliberate.
//
// Deliberately SessionStart rather than UserPromptSubmit: the latter fires on
// every user prompt and its text stays in the transcript, so the same tokens
// would be re-added each turn. Once per session costs that once.
//
// IMPORTANT: emit JSON with hookSpecificOutput.additionalContext. Plain stdout
// is accepted by Claude Code ("Hook output does not start with {, treating as
// plain text") and reported as a successful run, but for some hook events it is
// not injected into the model's context — a plain-text version of this hook
// silently did nothing at all. JSON is unambiguous, so use it.
//
// This is steering; the actual enforcement of the built-in Bash gate lives in
// the PreToolUse hook (gate-bash.mjs). SPLIT_CONTAINER_ENFORCE=off disables both.

const mode = (process.env.SPLIT_CONTAINER_ENFORCE ?? "all").toLowerCase();
if (mode === "off") process.exit(0);

const additionalContext =
  `[claude-split-container active for this session] Run shell commands in the container with the ` +
  `run_bash_container MCP tool (free, no approval) — it is the default. The built-in Bash tool runs on ` +
  `the host and is gated by a PreToolUse hook. For files, use the built-in Read/Write/Edit/Glob/Grep ` +
  `tools (the project dir is shared with the container). When a command seems to need the host, read ` +
  `the \`split-container\` skill (invoke it with the Skill tool) and follow its instructions — it covers ` +
  `how to decide and how to enable a host command. This holds for the whole session, including later turns.`;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext,
    },
  })
);
