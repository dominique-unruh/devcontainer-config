# PLAN: claude-split-container

MCP server + Claude Code skill for dual-environment work: host (gated,
confirmed) and devcontainer (free, no confirmation). Background: see
`../convo.html` (design discussion that led here — container-use rejected
because it forces a git-branch-per-environment model; this instead bind-mounts
the live project dir into a persistent container).

## Goals (from spec)

- `run_bash_host`: run a bash command on host. stdout/stderr each written as
  new files in shared dir. Return exit code + file names + sizes. Multiline
  commands run with `bash -e`. **Requires confirmation.**
- `read_file`: copy a host file into shared dir, return the new file's name.
  **Requires confirmation** (arbitrary host paths may hold secrets).
- `write_file`: copy a file from shared dir into an arbitrary host path, OR
  accept literal content directly instead of a shared-dir source.
  **Requires confirmation.**
- `patch_file`: apply a patch to a host file. Must fail atomically — no
  partial write if the patch doesn't apply. **Requires confirmation.**
- `run_bash_container`: run a bash command inside the project's devcontainer.
  Shares the same dir (bind mount), so no host/container file copying needed.
  **No confirmation** — always allowed.
- Every confirmed tool takes a required `reason` (markdown) explaining to
  the human why the caller wants to do this.
- Every tool (including `run_bash_container`) supports running as a
  **background job**: id assigned and returned immediately (even before
  confirmation), with `status`/`wait`/`kill` tools to manage it, and an
  `after` dependency list so one command can wait on others.
- Skill/config teaching the calling agent to: prefer container commands,
  decompose complex host pipelines into simple auditable steps (newline-
  separated, not `;`/`&&`), and prefer `patch_file` over `write_file` for
  text edits.

## Decisions made (confirmed with user)

| Question | Decision |
|---|---|
| Location/stack | This repo, `claude-split-container/`, TypeScript, own `package.json` (separate from the devcontainer-config CLI it sits next to) |
| Confirmation mechanism | **UI only for v1** — no MCP elicitation. A persistent local web dashboard is the sole approval surface (simplification requested explicitly, drops the earlier elicitation-support risk entirely) |
| Container exec | `devcontainer exec --workspace-folder <dir> -- bash -e -c '<cmd>'` (official `@devcontainers/cli`) |
| Patch application | POSIX `patch -p1 --dry-run` first; only apply for real if dry-run is clean; backup + restore on any unexpected failure from the real apply |
| `run_bash_container` output (foreground) | Returned inline in the tool response (stdout/stderr as text, truncated like Claude Code's built-in Bash tool does for very long output) — not routed through `.tmp` files, unlike `run_bash_host` (which the spec explicitly requires to use files) |
| UI implementation | Custom, TypeScript — a local-only HTTP server serving an HTML dashboard, not OS-native dialogs. Hosted in a standalone window by launching a Chromium-family browser in `--app` mode (chromeless; not a tab, not Electron), opened lazily on first item needing attention |
| `reason` param | Every confirmed tool (`run_bash_host`, `read_file`, `write_file`, `patch_file` — not `run_bash_container`) takes a required `reason: string` (markdown) |
| `background` param | Every tool (all 5) takes optional `background: boolean` (default `false`) |
| `timeout` param | `run_bash_host` and `run_bash_container` only. **Mandatory** when `background` is false. **Optional** when `background` is true (unset = no auto-timeout). Clock starts when the command actually enters `running` (both gates resolved), *not* at submission — a command can sit in `waiting-approval`/`waiting-dependencies` indefinitely without burning its timeout. (`wait`'s own `timeout` is unrelated — that one starts immediately when `wait` is called.) |
| `after` param | Every tool (all 5) takes optional `after: string[]` (command ids). Foreground calls with `after` still block on those ids before running |

## Job model — every tool call is a "command"

Every call to any of the 5 action tools creates a **command** record with a
unique `id`, independent of `background`. `background` only controls
whether the *MCP tool call* returns immediately (`{ id }`, before even
confirmation) or blocks until the command reaches a terminal state and
returns the full result.

**Status enum** (5 values — `waiting-approval` and `waiting-dependencies`
are distinguished, per explicit instruction): `waiting-approval |
waiting-dependencies | running | finished | rejected`.

A command has two independent gates: **approval-needed** (only the 4
confirmed tools; starts unresolved, resolves to approved/rejected via the
UI) and **deps-satisfied** (unresolved until every id in `after` has
succeeded). Approval and dependency-waiting proceed *concurrently* — the
human can approve/reject via the UI as soon as the command is submitted,
independent of whether its dependencies have finished yet. Displayed
status is derived from the two gates:

| Approval gate | Deps gate | Status |
|---|---|---|
| pending (needs approval, not yet given) | pending | `waiting-approval` (explicit rule: if waiting on both, show `waiting-approval`) |
| pending | satisfied | `waiting-approval` |
| resolved (approved, or tool needs no approval) | pending | `waiting-dependencies` |
| resolved | satisfied | `running` |

1. **Created** → status `waiting-approval` if the tool needs approval,
   else `waiting-dependencies` if it has unmet `after` ids, else straight
   to `running`.
2. Once **both gates resolve favorably** (approved-or-no-approval-needed,
   and every `after` id **succeeded** — status `finished` **and** no
   failure: for `run_bash_host`/`run_bash_container` that means
   `exitCode === 0`; for `read_file`/`write_file`/`patch_file` that means
   the operation completed without error) → status `running`, the actual
   work starts. A dependency that's `finished`-but-failed, or `rejected`,
   cascades as a rejection — see step 5 — regardless of which gate is
   still open on the dependent.
3. Work completes → status `finished`. Bash tools always land here once
   the process exits, *including non-zero exit codes* — the exit code is
   data on the result (`{ exitCode, ... }`), a job-status of `finished`
   just means "the process ran to completion and produced a result",
   success or failure is read off that result (this is also what step 2's
   `after`-check inspects). A timeout or a `kill` on an already-running
   command also resolves to `finished`, with `{ timedOut: true }` /
   `{ killed: true }` on the result (and, since a timed-out/killed process
   didn't exit 0, that also counts as "failed" for anyone depending on
   it) — reasoning: `rejected` is reserved for "a human (or a failed/
   rejected dependency) said this shouldn't happen", whereas timeout/
   kill-while-running means it *did* run, just didn't finish cleanly.
4. **Rejected** (human clicks Reject in the UI, with an optional note) →
   status `rejected`, `note` set from the UI. `kill` on a command still in
   `waiting-approval` (never started) also resolves to `rejected` (note:
   `"Killed via kill command before approval"`) since nothing ran.
5. **Cascade**: if any id in a command's `after` list resolves to
   `rejected`, *or* resolves to `finished` but failed (non-zero exit /
   operation error), the command itself immediately resolves to
   `rejected` with a note identifying the cause:
   `` Command <id> was rejected `` for a rejected dependency,
   `` Command <id> failed (exit code <n>) `` / `` Command <id> failed: <error> ``
   for a failed one. This propagates transitively — one failure or
   rejection can cascade through a whole dependency chain.

## New tools

### `status(ids: string[])`
Returns the current record for each given command id: `{ id, tool,
status, note?, result? }[]`. Non-blocking, works for any id (background
or not).

### `running()`
No args. Returns the list of ids currently in status `running` — a
sweep/overview tool, doesn't need ids up front (unlike `status`/`wait`).

### `wait(ids: string[], timeout: number)`
`timeout` mandatory. Blocks until **any** of the given commands reaches a
terminal state (`finished` or `rejected`), or `timeout` seconds elapse
(returns current non-terminal states for all of them on timeout rather
than erroring).
Returns records for all ids passed in (so the caller can see which one(s)
resolved and the still-pending state of the rest), same per-record shape
as `status`. Caller polls again with the remaining ids to wait for the
next one, if waiting on more than one to fully complete.

### `kill(id: string)`
Cancels a command:
- `waiting-approval` or `waiting-dependencies` → nothing has started
  running yet either way, becomes `rejected` (note: `"Killed via kill
  command before approval"` / `"...before dependencies finished"`),
  cascades to dependents.
- `running` → sends SIGTERM (then SIGKILL after a grace period) to the
  underlying process (`bash -e` or `devcontainer exec`), becomes
  `finished` with `killed: true` once the process actually exits (which
  then also cascade-rejects anything depending on it, per the
  succeeded-means-`exitCode===0` rule).
- Already terminal (`finished`/`rejected`) → error, no-op.

## Tool signatures (revised)

### `run_bash_host(command: string, reason: string, background?: boolean, timeout: number, after?: string[])`
`timeout` mandatory when `background` is false/omitted; optional when
`background` is true.
1. Create command record, id assigned (initial status per the two-gate
   table above). If `background` → return `{ id }` immediately.
2. Approval gate and dependency gate proceed concurrently (UI shows it in
   the queue right away, `after` ids are watched in parallel). Either
   gate resolving unfavorably (reject, or a dependency that's rejected/
   failed) → stop, status `rejected` with the appropriate note.
3. Both gates resolve favorably → status `running`, run `bash -e -c
   "<command>"`, cwd = project dir, enforce `timeout`.
4. Write stdout → `.tmp/<ts>-<id>.stdout`, stderr → `.tmp/<ts>-<id>.stderr`
   (always both files, even if empty).
5. Result: `{ exitCode, timedOut?, killed?, stdoutFile: {name, bytes},
   stderrFile: {name, bytes} }`.

### `read_file(path: string, reason: string, background?: boolean, after?: string[])`
1. Create record (+ early return if `background`).
2. Approval (shows `reason` + resolved absolute path) and `after`-wait
   proceed concurrently; either resolving unfavorably → `rejected`.
3. Both favorable → copy to `.tmp/<id>-<basename(path)>`.
4. Result: `{ file: {name, bytes} }`.

### `write_file(destPath: string, source: {sharedFile: string} | {content: string}, reason: string, background?: boolean, after?: string[])`
1. Create record (+ early return if `background`).
2. Approval (shows `reason`, destPath, and either the shared-dir source
   filename or a preview/full text of inline content) and `after`-wait
   concurrently; either unfavorable → `rejected`.
3. Both favorable → copy/write accordingly (creates parent dirs as
   needed).
4. Result: `{ bytesWritten }`.

### `patch_file(targetPath: string, patch: string, reason: string, background?: boolean, after?: string[])`
1. Create record (+ early return if `background`).
2. Approval (shows `reason`, targetPath, patch text) and `after`-wait
   concurrently; either unfavorable → `rejected`.
3. Both favorable → backup targetPath, `patch -p1 --dry-run`. Dry-run
   fails → error, nothing touched. Dry-run OK → real `patch -p1`;
   unexpected failure → restore backup, error. Success → drop backup.
4. Result: `{ applied: true }`.

### `run_bash_container(command: string, background?: boolean, timeout: number, after?: string[])`
No `reason`, no approval gate — always "resolved" on that axis, so status
goes `waiting-dependencies` (if `after` unmet) or straight to `running`,
never `waiting-approval`.
1. Create record (+ early return if `background`).
2. Wait on `after` (a rejected/failed dependency still cascades this to
   `rejected`).
3. `devcontainer exec --workspace-folder <project-dir> -- bash -e -c
   "<command>"`, enforce `timeout`.
4. Result (foreground): stdout/stderr inline, truncated past ~30k chars
   like Claude Code's built-in Bash tool. `{ exitCode, timedOut?, killed?,
   stdout, stderr }`.

## Approval UI — persistent local dashboard

Not a one-shot popup anymore (multiple commands can be queued
concurrently via `background`) — a small persistent server, started once
at MCP server startup (or lazily on first command), serving:
- `GET /` — dashboard listing all commands, grouped by status. Each
  `waiting-approval` entry needing human sign-off shows `reason`
  (rendered markdown), tool name, and the relevant details (command
  text / paths / diff), with **Approve** and **Reject** (opens a note
  textarea) buttons.
- Live updates via polling (`fetch` every ~1s) — no dependency on a JS
  framework, plain HTML + a small script.
- Backend: `GET /api/commands`, `POST /api/commands/:id/approve`,
  `POST /api/commands/:id/reject { note }`.
- **Not a browser tab** — a standalone window, opened by launching a
  Chromium-family browser in `--app=<url>` mode (chromeless: no tabs, no
  address bar). Falls back to a plain browser tab only if no such browser
  exists.
  *(Superseded design: this originally used the `webview` npm package —
  native bindings to the zserge/webview C library, rendering via the OS's
  installed webview component. Dropped in practice: the published binary
  links `libwebkit2gtk-4.0`, which current distros replaced with 4.1, so
  it never started on an up-to-date Linux box and always fell through to
  the browser anyway, for a ~32 MB dependency.)*
- Window opens **lazily**, on the first command that needs human
  attention — not at server startup — so a Claude Code session that never
  touches these tools never pops a window.
- Future extension (not v1, just keeping the design compatible): a single
  shared UI daemon process that multiple `claude-split-container`
  instances (one per project) register jobs with, living in the taskbar
  rather than one window per project. v1's `ui/dashboardServer.ts` stays
  a separate, swappable component from the window-hosting code
  specifically so this is a later addition, not a rewrite — the HTTP
  API/auth-key design doesn't change either way.
- Built to grow: v1 is a plain list + two buttons per item; richer diff
  rendering etc. is additive later, not a rewrite.

**Auth**: server generates a random key (e.g. 32 bytes, base64url) at
startup. The URL it opens in the browser embeds it as a query param
(`http://127.0.0.1:<port>/?key=<key>`); the dashboard page reads it from
`location.search` and attaches it (as a header or query param) to every
`/api/*` call. Any request missing/mismatching the key is rejected
(401). Listens on `127.0.0.1` only (not `0.0.0.0`) as a second layer —
the key is what stops another local user/process on a shared machine
from hitting the API, the loopback bind is what stops the network.

## Package layout

```
claude-split-container/
  PLAN.md
  claude-split-container # launcher script: runs `node dist/server.js` next to itself
  package.json           # deps: @modelcontextprotocol/sdk, zod
  tsconfig.json
  src/
    server.ts             # entrypoint, registers tools, stdio transport
    jobs.ts                # command record store, status transitions, cascade-on-reject, after-wait
    tools/
      runBashHost.ts
      readFile.ts
      writeFile.ts
      patchFile.ts
      runBashContainer.ts
      status.ts
      wait.ts
      kill.ts
      running.ts
    ui/
      dashboardServer.ts   # persistent local HTTP server (auth key, /api/commands, approve/reject)
      dashboard.html        # (or generated inline) list + approve/reject
      window.ts             # app-mode browser window, opened lazily
    sharedDir.ts            # .tmp/ naming, write-output-file helpers
    devcontainerExec.ts     # wraps `devcontainer exec`
  .claude-plugin/
    plugin.json             # makes this dir a Claude Code plugin (skill + MCP server in one --plugin-dir)
  .mcp.json                 # plugin-bundled MCP server registration (${CLAUDE_PLUGIN_ROOT}/claude-split-container)
  skills/
    split-container/
      SKILL.md              # the "prefer container / decompose / prefer patch" guidance
  README.md                 # setup: `claude mcp add`, required host tools (devcontainer CLI, patch, a Chromium-family browser)
```

## Config / how the server locates things

- Project dir (= shared dir) **defaults to `process.cwd()`** — Claude Code
  spawns stdio MCP servers with cwd set to wherever it was launched from,
  which is the project root in normal use, so no explicit config is
  needed for the common case. Overridable via a `--project-dir` CLI arg
  or `PROJECT_DIR` env var for edge cases (nested cwd at launch, a
  globally-registered server, multi-root setups) — resolved once at
  startup, one server instance is scoped to one project either way.
- Shared-dir subpath is fixed: `<project>/.tmp/`. Created on first use if
  missing. `README.md` will tell users to add `.tmp/` to the project's
  `.gitignore`.
- Container target is whatever `devcontainer exec --workspace-folder
  <project-dir>` resolves (starts it if not running — first call may be
  slow).

## Skill content (`skill/SKILL.md`)

Guidance for the calling agent, roughly:
- Prefer `run_bash_container` over `run_bash_host` whenever the task
  doesn't specifically require the host (installing to the host system,
  reading host-only files/secrets, host-specific tooling).
- When a host command is necessary, keep it simple and decomposed — e.g.
  instead of `dangerous_command | grep token` on the host, run
  `dangerous_command` on the host (writes to `.tmp/*.stdout`), then `grep
  token .tmp/<file>.stdout` via `run_bash_container`. Rationale stated
  explicitly: a human approving the command needs to read and understand
  it in a few seconds; long pipelines are hard to audit, container
  commands aren't gated so complexity there is free.
- If several commands are needed, pass them as one call with newline
  separators, not `;`/`&&` — keeps each line independently readable in
  the approval UI.
- For editing existing text files on the host, prefer `patch_file` over
  `write_file` — a diff is auditable at a glance, a full-file overwrite
  isn't.
- Use `background`+`after` to parallelize independent work (e.g. kick off
  a long host build in the background, keep working via the container,
  `wait` on it later) instead of blocking a whole turn on one slow
  approval.
- When exploring (several independent host reads/commands whose need
  isn't yet certain, or whose results don't block each other), fire them
  all as `background` calls up front rather than one at a time. This
  batches everything into the approval dashboard at once, so the human
  reviews and clicks through them together instead of getting
  interrupted repeatedly, one popup per call.
- Write a clear, specific `reason` — it's the first thing the human sees
  in the approval UI and is what makes a fast approve/reject decision
  possible.
- Inside the container, feel free to install whatever tools are needed
  (`sudo apt-get install ...` etc.) — the container is disposable and
  exists only for this work, unlike the host.

Resolved: **both** — short reminders in the tool descriptions themselves,
`skills/split-container/SKILL.md` for the fuller rationale.

## Registration (for this repo / any consuming project)

This directory doubles as a Claude Code **plugin**, so one flag loads the
MCP server *and* the skill together — nothing to copy or register:

```
claude --plugin-dir <path>/claude-split-container
```

Verified end-to-end: the skill shows up as
`claude-split-container:split-container` and the tools as
`mcp__plugin_claude-split-container_split__*`.

The plugin's bundled server registration (`.mcp.json` at plugin root) —
no `--project-dir` needed, the server picks up cwd (= project root, where
`claude` was launched):

```jsonc
{
  "mcpServers": {
    "claude-split-container": {
      "command": "${CLAUDE_PLUGIN_ROOT}/claude-split-container"
    }
  }
}
```

```jsonc
// settings.json — confirmation is UI-driven inside the server, not via
// Claude Code's own permission system, so all of this server's tools can
// just be allowed to be *called* (the server decides whether the
// underlying action proceeds):
{
  "permissions": {
    "allow": ["mcp__plugin_claude-split-container_split__*"]
  }
}
```

(Registered by hand via `claude mcp add` instead of as a plugin, the
tools are named `mcp__claude-split-container__*` — no `plugin_` prefix —
so the glob has to match that form instead.)

## Build/verification plan

1. `jobs.ts` (record store + status machine + cascade + after-wait logic)
   first — everything else depends on it, and it's pure logic, easiest to
   get right in isolation.
2. Dashboard server (approve/reject over HTTP + polling list) next, since
   every confirmed tool needs it.
3. Implement tools in order: `run_bash_container` (simplest — no approval)
   → `run_bash_host` → `read_file`/`write_file` → `patch_file` →
   `status`/`wait`/`kill`/`running`.
4. Manual smoke test against this repo itself as the target project (has
   a devcontainer already) — including a background + `after`-chain
   scenario and a rejection-with-cascade scenario.
5. No automated test suite planned initially, matching this repo's own
   convention (manual smoke-testing) — flag if you want one anyway for
   `jobs.ts` specifically, since that logic (cascade, dependency-wait) is
   the least trivial part and most amenable to unit testing.

## Judgment calls made this round (flagging for review, not blocking on them)

1. ~~`waiting-approval` reused as the generic "not started yet" bucket~~ —
   **updated**: 5 statuses now, `waiting-approval` and
   `waiting-dependencies` distinguished (see two-gate table above); when
   both gates are open, displayed status is `waiting-approval` per
   explicit instruction.
2. Timeout and kill-while-`running` resolve to `finished` (with
   `timedOut`/`killed` flags on the result), not `rejected` — reserving
   `rejected` for actual human/cascade refusal. Kill-while-`waiting-
   approval` (never started) does resolve to `rejected`, since in that
   case nothing ran.
3. ~~`after` dependency satisfaction checks job-status `finished`, not the
   bash exit code~~ — **updated**: exit code (bash tools) / operation
   success (file tools) now matters. A dependency that ran but failed
   cascade-rejects its dependents, same as an explicitly-rejected one.
4. Dashboard is a single persistent server for the whole session (opened
   once at startup), not spun up per-confirmation — needed once
   `background` allows multiple concurrent pending approvals.
