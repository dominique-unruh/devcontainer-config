#!/usr/bin/env node
// PreToolUse hook on the built-in Bash tool.
//
// The built-in Bash runs on the host. In a split-container session routine shell
// work belongs in the container (`run_bash_container` — free, no approval), so this
// hook DENIES a built-in Bash call unless the command opts in explicitly by making
// its first line start with `# NOT IN CONTAINER:` followed by a very short reason why
// it can't run in the container. That marker forces a genuine host command to
// self-declare with a justification.
//
// The deny reason (below) deliberately does NOT spell out the marker syntax: it points
// the model at the split-container skill and tells it to read that first. The intent is
// to force the skill to be read at the point of use (its host/container checks and the
// unlock syntax live only there), rather than duplicating that guidance in hook text.
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
  "Built-in Bash runs on the host and is gated in this split-container session.",
  "Most shell work belongs in the container: run it with the `run_bash_container` MCP tool (free, no approval).",
  "If you believe this command genuinely needs the host, read the `split-container` skill now (invoke it with the Skill tool) and follow its instructions to: (a) decide whether it can instead run in the container — possibly reformulated, split, or redirected through `.tmp/`; and (b) if it truly must run on the host, enable it the way the skill describes.",
  "This message deliberately omits how to enable a host command — that is in the skill, so read it.",
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
