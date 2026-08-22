# claude-split-container

MCP server for dual-environment Claude Code work: gated, human-approved
access to the **host** machine, and free (no-approval) access to the
project's **devcontainer**. See `PLAN.md` for the full design.

## Requirements

- Node.js (for running the server itself).
- [`@devcontainers/cli`](https://github.com/devcontainers/cli) installed
  and on `PATH` (`npm i -g @devcontainers/cli`) — used for `run_bash_container`.
- POSIX `patch` on `PATH` — used for `patch_file`.
- For the approval UI's standalone window, any Chromium-family browser
  (Chromium, Chrome, Brave, Edge, Vivaldi) — used in `--app` mode, which
  gives a chromeless window with no tabs or address bar. Without one the
  dashboard still works, just as an ordinary browser tab.

## Build

```
npm install
npm run build      # bundles src/server.ts -> dist/server.js
npm run typecheck
npm test
```

## Use it (recommended: as a plugin)

This directory is a Claude Code **plugin**: it bundles both the MCP
server (`.mcp.json`) and the guidance skill (`skills/split-container/`).
One flag gives you everything, with nothing to copy or register:

```
claude --plugin-dir <path-to-this-repo>/claude-split-container
```

That loads, for the session:

- the MCP server, as
  `mcp__plugin_claude-split-container_claude-split-container__*`
- the skill, as `claude-split-container:split-container` — which teaches
  Claude to prefer the container, keep host commands simple and
  decomposed, batch approvals via background jobs, and prefer
  `patch_file` over `write_file`.

Approval happens inside this server (via the local dashboard UI), not
through Claude Code's own permission prompts — so allow its tools to be
*called* and let the server decide whether the underlying action
proceeds:

```jsonc
// settings.json
{
  "permissions": {
    "allow": ["mcp__plugin_claude-split-container_claude-split-container__*"]
  }
}
```

### Alternative: register the MCP server by hand

If you'd rather not use the plugin wrapper:

```
claude mcp add --scope project claude-split-container -- <path-to-this-repo>/claude-split-container/claude-split-container
```

`claude-split-container` is a small launcher script that just runs
`node dist/server.js` next to itself — it resolves its own location (and
follows symlinks), so you can also symlink it onto your `$PATH` and
register it as just `claude-split-container`:

```
ln -s <path-to-this-repo>/claude-split-container/claude-split-container ~/.local/bin/
claude mcp add --scope project claude-split-container -- claude-split-container
```

Registered this way the tools are named `mcp__claude-split-container__*`
(no `plugin_` prefix), so adjust the permissions glob accordingly. The
skill then has to be installed separately — copy or symlink it:

```
mkdir -p .claude/skills
ln -s <path-to-this-repo>/claude-split-container/skills/split-container .claude/skills/
```

Use `~/.claude/skills/` instead of `.claude/skills/` to get it in every
project.

### Project directory

No `--project-dir` flag is needed for the common case — the server picks
up `process.cwd()`, which is the directory `claude` was launched from.
Pass `--project-dir <dir>` or set `PROJECT_DIR` explicitly if that
assumption doesn't hold for your setup (e.g. a globally-registered
server, or launching `claude` from a nested directory).

## Project directory and `.tmp/`

The **project directory** is what host and container share — it's the
same files on both sides, so anything written in one is immediately
visible in the other. It's also what "the shared dir" means throughout
this project; there is no separate shared location.

Inside it, **`.tmp/`** is where this server puts files it names itself:
`run_bash_host`'s captured stdout/stderr, copies made by `read_file`, and
`claude-split-container.log`. Add it to the project's `.gitignore`:

```
.tmp/
```

## Tools

| Tool | Approval | Notes |
|---|---|---|
| `run_bash_host` | required | `bash -e -c`, stdout/stderr written to `.tmp/*.stdout`/`.stderr` |
| `read_file` | required | copies a host file into `.tmp/` |
| `write_file` | required | writes a `.tmp/` file or literal content to a host path |

File names come back project-relative, prefix included (e.g.
`.tmp/1787391261592-2-f84baf66.stdout`), so they can be used verbatim —
as a path in a container command, with the built-in file tools, or as
`write_file`'s `sharedFile`. A bare filename is accepted there too.
| `patch_file` | required | applies a unified diff, atomically (dry-run first, backup + restore on failure) |

The three file tools are for host files **outside** the project dir. For
files inside it, use Claude Code's ordinary `Read`/`Write`/`Edit` — the
project dir is already shared with the container, so those need no
approval and are the faster path.

| `run_bash_container` | none | `devcontainer exec`, output returned inline |
| `status` | — | look up one or more command ids |
| `wait` | — | block until any of several ids finishes/is rejected (mandatory timeout) |
| `kill` | — | cancel a pending or running command |
| `running` | — | list ids currently running |

All 5 action tools accept `background` (return an id immediately, before
approval) and `after` (a list of command ids that must all succeed
first). `run_bash_host`/`run_bash_container` additionally take
`timeout` (mandatory in the foreground, optional in the background).

## Approval UI

The first command needing human approval opens a small standalone window
showing the pending queue, with Approve/Reject (optionally with a note)
per item. It's a local HTTP server bound to `127.0.0.1`, protected by a
random key baked into the URL.

The UI is tried in two steps, stopping at the first that works:

1. **App-mode window** (`chromium --app=…`) — a chromeless standalone
   window, no tabs or address bar, using a browser you already have.
2. **Plain browser tab** — last resort, and the only case that raises a
   warning, since it's not the intended UI.

If both fail, the tool call returns an error containing the URL rather
than hanging — the command stays queued, so opening the URL by hand and
approving still runs it, and `status`/`wait` on the returned id picks up
the result.

(An earlier version bundled a native-webview binary as step 1. It was
dropped: it linked `libwebkit2gtk-4.0`, an EOL library current distros
have replaced with 4.1, so it failed to start on any up-to-date Linux
machine and fell through to the browser anyway — for a ~32 MB dependency
and a confusing first-run failure.)

## When something goes wrong

An MCP server's stderr is captured by the client, so anything printed
there is effectively invisible. Failures are therefore reported in three
places you can actually see:

- **A banner in the dashboard**, when the approval UI had to fall back to
  the browser, naming the reason.
- **`.tmp/claude-split-container.log`** in the project dir — a plain
  timestamped log of the same events.
- **A one-time `warning` field** on the first affected tool result, so
  Claude can pass the problem on to you rather than silently degrading.
  It appears once per server run, not on every call.

To investigate the approval window specifically:

```
claude-split-container --doctor
```

It reports the project and `.tmp` paths, `DISPLAY`/`WAYLAND_DISPLAY`,
which app-mode browser was found (if any), and the plain-tab opener that
would be used as a last resort — plus, when no browser is available, the
ones to install to get a standalone window back.

## Steering the workflow

A skill is only consulted when it looks relevant, so on its own Claude
tends to reach for the built-in `Bash`/`Read`/`Edit` tools out of habit
and you end up saying "use the split container plugin" by hand. The
plugin therefore ships a **SessionStart** hook that states the workflow
up front, so the right tool gets picked from the first turn.

It runs once per session rather than on every prompt, so it costs its
~180 tokens once instead of re-adding them to the transcript each turn.

Nothing is blocked — the built-in tools remain available, and this is
steering rather than enforcement. Set the permissions in `settings.json`
if you want a hard guarantee.

The hook must emit JSON with `hookSpecificOutput.additionalContext`.
Plain stdout is reported as a successful hook run but isn't injected, so
a plain-text version fails silently — `tests/hooks.test.ts` guards this.

Control it with `SPLIT_CONTAINER_ENFORCE`:

| Value | Effect |
|---|---|
| `all` (default) | steer shell commands, and spell out the file split: built-in tools inside the project dir, MCP tools for host files outside it |
| `bash` | steer only shell commands; say nothing about files |
| `off` | emit nothing |

The hook reads the environment of the `claude` process, so set it for the
whole session (`SPLIT_CONTAINER_ENFORCE=off claude …`), not per call.
