import { spawn } from "node:child_process";
import type { DevcontainerDocument } from "./devcontainerJson.js";
import { DOCKER_BIN } from "./docker.js";
import type { DevcontainerJson } from "./types.js";

// Top-level lifecycle commands that leave a marker file in the remoteUser's
// $HOME once everything before them succeeded. The devcontainer CLI runs
// every feature's command of a phase before devcontainer.json's own, and
// stops at the first failure ("Skipping any further user-provided
// commands") — so the marker exists only if all earlier lifecycle commands
// passed. Its own ~/.devcontainer/.*Marker files can't tell us that: they
// are written when a phase *starts*, success or not.
export const MARKER_COMMANDS = {
  postCreateCommand: "touch ~/.devcontainer-config-created",
  postStartCommand: "touch ~/.devcontainer-config-started",
} as const;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A user's own command counts as already carrying the marker if it is
// exactly the marker command or ends with "&& <marker>" (marker only if
// their command succeeded) or "; <marker>" (they deliberately chose to
// ignore their own command's exit status — respected as intentional).
export function hasMarkerCommand(existing: unknown, marker: string): boolean {
  if (typeof existing !== "string") return false;
  return new RegExp(`(^|;|&&)\\s*${escapeRegExp(marker)}\\s*$`).test(existing.trim());
}

function dockerOutput(args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const child = spawn(DOCKER_BIN, args, { stdio: ["ignore", "pipe", "ignore"] });
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", () => resolve({ code: 1, stdout: "" }));
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(chunks).toString("utf8") }));
  });
}

// Docker prints .State.StartedAt as RFC 3339; podman's docker emulation
// prints Go's default time format instead ("2026-10-31 01:08:30.607861823
// +0100 CET"), which Date.parse rejects — rewrite that into ISO form.
function parseStartedAt(s: string): number {
  const m = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)(\.\d+)? ([+-]\d\d)(\d\d)/.exec(s);
  return Date.parse(m ? `${m[1]}T${m[2]}${(m[3] ?? "").slice(0, 4)}${m[4]}:${m[5]}` : s);
}

// Verifies the markers inside a running container: the postCreate marker
// must exist, the postStart marker must be no older than the container's
// current start (it's rewritten on every start, so a stale one means this
// start's postStart — or something before it — failed). Only checks the
// markers whose command devcontainer.json actually carries. Uses plain
// `docker exec` (as remoteUser, so ~ is the same $HOME the lifecycle
// commands used) rather than `devcontainer exec`, which would cost a whole
// extra userEnvProbe per `run`. Returns null if fine, else which marker is
// missing/stale (phase undefined if the check itself couldn't run).
export interface MarkerProblem {
  phase?: "postCreateCommand" | "postStartCommand";
  message: string;
}

export async function checkMarkers(config: DevcontainerJson, containerId: string): Promise<MarkerProblem | null> {
  const checkCreated = hasMarkerCommand(config.postCreateCommand, MARKER_COMMANDS.postCreateCommand);
  const checkStarted = hasMarkerCommand(config.postStartCommand, MARKER_COMMANDS.postStartCommand);
  if (!checkCreated && !checkStarted) return null;

  const inspect = await dockerOutput(["inspect", "-f", "{{.State.StartedAt}}", containerId]);
  const startedAt = Math.floor(parseStartedAt(inspect.stdout.trim()) / 1000);
  if (inspect.code !== 0 || Number.isNaN(startedAt)) {
    return { message: `could not inspect container ${containerId.slice(0, 12)}` };
  }

  const tests: string[] = [];
  if (checkCreated) tests.push(`test -f ~/.devcontainer-config-created || { echo postCreateCommand; exit 1; }`);
  if (checkStarted) {
    tests.push(
      `t=$(stat -c %Y ~/.devcontainer-config-started 2>/dev/null) && [ "$t" -ge "$1" ] || { echo postStartCommand; exit 1; }`,
    );
  }
  const user = config.remoteUser ? ["-u", config.remoteUser] : [];
  const result = await dockerOutput(["exec", ...user, containerId, "sh", "-c", tests.join("\n"), "_", String(startedAt)]);
  if (result.code === 0) return null;
  const out = result.stdout.trim();
  const phase = out === "postCreateCommand" || out === "postStartCommand" ? out : undefined;
  return {
    phase,
    message: phase
      ? `the container's ${phase} (or a lifecycle command before it) did not complete successfully`
      : `could not check container ${containerId.slice(0, 12)}`,
  };
}

// Adds any missing marker command to the document. Never overwrites a
// different command the project already configured (string, array or
// object form) — warns instead, saying how to opt in by hand.
export function ensureMarkerCommands(doc: DevcontainerDocument): void {
  const config = doc.config;
  for (const [key, marker] of Object.entries(MARKER_COMMANDS)) {
    const existing = config[key];
    if (existing === undefined) {
      doc.setTopLevel(key, marker);
    } else if (!hasMarkerCommand(existing, marker)) {
      console.warn(
        `warning: devcontainer.json already has a different ${key}; not adding devcontainer-config's marker. ` +
          `To enable it, make the ${key} a string ending in "&& ${marker}".`,
      );
    }
  }
}
