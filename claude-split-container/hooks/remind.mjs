#!/usr/bin/env node
// SessionStart hook: state the split-container workflow once, at the start of
// the session, so the model routes work to run_bash_container without having to
// be told and without waiting to load the skill.
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
  `[claude-split-container active for this session] Run shell commands with run_bash_container ` +
  `(free, no approval) — it is the default. The built-in Bash tool runs on the host and is denied ` +
  `by a PreToolUse hook unless its first line is \`# NOT IN CONTAINER: <reason>\`, where <reason> is ` +
  `a very short sentence saying why it can't run in the container — so prefer run_bash_container, and ` +
  `only mark a command that way when it genuinely must run on the host. For files, use the built-in ` +
  `Read/Write/Edit/Glob/Grep tools (the project dir is shared with the container, so no approval is ` +
  `needed). Job control is available too: status/wait/kill/running, plus background/after on ` +
  `run_bash_container. This holds for the whole session, including later turns — apply it without ` +
  `being asked and without loading the split-container skill first; consult that skill for the ` +
  `fuller rationale.`;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext,
    },
  })
);
