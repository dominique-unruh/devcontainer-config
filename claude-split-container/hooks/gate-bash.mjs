#!/usr/bin/env node
// PreToolUse hook on the built-in Bash tool.
//
// The built-in Bash runs on the host. In a split-container session routine shell
// work belongs in the container (`run_bash_container` — free, no approval), so this
// hook DENIES a built-in Bash call unless the command opts in explicitly by making
// its first line start with `# NOT IN CONTAINER:` followed by a very short reason why
// it can't run in the container. That marker forces a genuine host command to
// self-declare with a justification, and the deny reason (below) keeps the routing
// guidance in front of the model at the point of use — where the once-per-session
// SessionStart prose stopped being salient after it scrolled up-context.
//
// SPLIT_CONTAINER_ENFORCE=off disables the gate (Bash behaves normally); any other
// value (default "all") keeps it on.

import { readFileSync } from "node:fs";

const mode = (process.env.SPLIT_CONTAINER_ENFORCE ?? "all").toLowerCase();
if (mode === "off") process.exit(0);

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0); // no/invalid stdin: nothing to inspect, don't block
}

const command = input?.tool_input?.command ?? "";
const firstLine = command.split(/\r?\n/, 1)[0].trim();
if (firstLine.startsWith("# NOT IN CONTAINER")) process.exit(0); // explicit host opt-in: allow

const reason = [
  "Built-in Bash runs on the host and is gated in this split-container session. Instead:",
  "- If possible, run it in the container with the `run_bash_container` MCP tool (free, no approval) — see the split-container skill.",
  "- Before going to the host, check FIRST:",
  "  - Can it run in the container (possibly reformulated)?",
  "  - Can you split it into a container part and a host part, and run only the host part here (e.g. `pdflatex` in the container, `lpr` on the host)?",
  "  - Can you redirect input/output through `.tmp/` and do the processing in the container?",
  "  - Path confusion? The built-in tools (Read/Write/Grep, host Bash) speak the HOST path; only `run_bash_container` speaks the CONTAINER path — same file, two spellings under different roots. A host path you can't find in the container is usually just the other spelling.",
  "  - If the container itself seems down / has no network / errors unrelatedly, DON'T fall back to the host — tell the user the exact problem instead.",
  "- To run on the host anyway, make the command's FIRST line `# NOT IN CONTAINER: <reason>`, where <reason> is a very short sentence saying why it can't be done in the container. It must justify EVERY line of the command.",
  "- Prefer a multiline command (one statement per line) over chaining with `&&` / `;` etc.",
  "- Avoid pipe constructions: instead of `command | grep ...`, write `command > .tmp/output`, then run `grep ... .tmp/output` in the container.",
  "- Generally make host bash commands as easy for a human to audit as possible.",
].join("\n");

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  })
);
