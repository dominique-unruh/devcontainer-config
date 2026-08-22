#!/usr/bin/env node
// PreToolUse hook: deny Claude Code's built-in host tools and point at the
// claude-split-container MCP equivalents instead.
//
// Why this exists: the skill only *suggests* the split-container workflow, so
// the model still reaches for the built-in Bash/Read/Edit tools by default and
// the user has to say "use the split container skill" out loud. Denying the
// built-ins makes the MCP tools the only option, so the workflow applies
// automatically.
//
// Scope is controlled by SPLIT_CONTAINER_ENFORCE:
//   all   (default) - block bash + every host file tool
//   bash            - block only Bash
//   off             - block nothing (hook becomes a no-op)

const BASH_TOOLS = ["Bash", "BashOutput", "KillShell"];
const FILE_TOOLS = ["Read", "Write", "Edit", "NotebookEdit", "Glob", "Grep"];

const REDIRECTS = {
  Bash: "run_bash_container (free, no approval) for anything that doesn't specifically need the host, or run_bash_host (human-approved) when it does",
  BashOutput: "run_bash_container / run_bash_host with background:true, then status/wait",
  KillShell: "the kill tool",
  Read: "run_bash_container (e.g. `cat <path>`) for files in the shared project dir, or read_file for host files outside it",
  Write: "run_bash_container for files in the shared project dir, or write_file for host files",
  Edit: "run_bash_container for files in the shared project dir, or patch_file (preferred over write_file — a diff is auditable at a glance) for host files",
  NotebookEdit: "run_bash_container for files in the shared project dir, or patch_file for host files",
  Glob: "run_bash_container (e.g. `find` / `ls`)",
  Grep: "run_bash_container (e.g. `grep -rn ...`)",
};

/** Tools to deny, per the SPLIT_CONTAINER_ENFORCE setting. */
function blockedTools() {
  const mode = (process.env.SPLIT_CONTAINER_ENFORCE ?? "all").toLowerCase();
  if (mode === "off") return [];
  if (mode === "bash") return BASH_TOOLS;
  return [...BASH_TOOLS, ...FILE_TOOLS];
}

/** Read all of stdin as a string. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/** Emit a PreToolUse hook result and exit. */
function respond(output) {
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

const raw = await readStdin();
let toolName = "";
try {
  toolName = JSON.parse(raw).tool_name ?? "";
} catch {
  respond({}); // unparseable payload — stay out of the way
}

if (!blockedTools().includes(toolName)) respond({});

respond({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason:
      `The claude-split-container plugin is active, so the built-in ${toolName} tool is disabled — ` +
      `host access is routed through this plugin's MCP tools instead (they carry the approval UI). ` +
      `Use ${REDIRECTS[toolName] ?? "the claude-split-container MCP tools"}. ` +
      `See the split-container skill for how to structure the work: prefer the container, keep host ` +
      `commands simple and decomposed so they're easy to approve, and batch independent host actions ` +
      `with background:true.`,
  },
});
