# claude-split-container

MCP server + hooks + skill for dual-environment Claude Code work: a free
(no-approval) **devcontainer** that shares the project dir and is the default
for shell commands, plus a **host** reachable only through Claude Code's
built-in `Bash` tool, gated by a hook. See `PLAN.md` for the (now partly
historical) design rationale.

## Requirements

- Node.js (for running the server itself).
- [`@devcontainers/cli`](https://github.com/devcontainers/cli) installed
  and on `PATH` (`npm i -g @devcontainers/cli`) — used for `run_bash_container`.

## Build

```
npm install
npm run build      # bundles src/server.ts -> dist/server.js
npm run typecheck
npm test
```

## Install it permanently

```
./install.sh
```

Installs the plugin into the local Claude Code, or refreshes it if it is
already installed; re-run it after any source change. Restart Claude Code
to pick up the result. `--scope user|project|local` (default `user`) and
`--no-build` are accepted.

The script builds, registers this directory as a marketplace, and
installs `claude-split-container@devcontainer-config`. (`.claude-plugin/`
holds both manifests: `marketplace.json`, listing one plugin sourced as
`./`, and `plugin.json` for the plugin itself. The marketplace is named
after the repo rather than this directory so the id doesn't read as the
same word twice.) Two things about the install are worth knowing:

- `claude plugin install` **snapshots** the plugin directory into
  `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` rather than
  referencing this tree — so edits here don't reach the installed copy
  until you re-run the script. The snapshot does include `dist/` and
  `node_modules/`, gitignored though they are, so the built server comes
  along.
- The refresh is `uninstall` + `install`, not `claude plugin update`.
  `update` compares manifest versions and no-ops when they match, which
  is the normal case for a working tree whose version rarely moves.

The MCP tools need no human approval, so allow them to be called without a
prompt:

```jsonc
// settings.json
{
  "permissions": {
    "allow": ["mcp__plugin_claude-split-container_split__*"]
  }
}
```

## Use it for one session only

This directory is a Claude Code **plugin**: it bundles the MCP server
(`.mcp.json`), the hooks, and the guidance skill (`skills/split-container/`).
One flag gives you everything, with nothing installed:

```
claude --plugin-dir <path-to-this-repo>/claude-split-container
```

That loads, for the session:

- the MCP server, as
  `mcp__plugin_claude-split-container_split__*` — so calls show up in
  the transcript as e.g. `split - run_bash_container (MCP)(command: …)`. The
  server is deliberately named `split` rather than repeating the plugin
  name, which would otherwise render as the uninformative
  `claude-split-container:claude-split-container`.
- the hooks (see **Steering the workflow** below).
- the skill, as `claude-split-container:split-container` — which teaches
  Claude to prefer the container, reach for the host only via the
  `# NOT IN CONTAINER` marker, and keep host commands simple and auditable.

The same permissions allowlist as above applies.

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
hooks and skill are **not** loaded this way — the plugin wrapper is what
ships those. To get the skill, copy or symlink it:

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

Inside it, **`.tmp/`** is a convenient scratch location: a host command can
redirect its output there (`something > .tmp/out`) and a container command
(or the built-in `Read`/`Grep`) can then read it with no ceremony, since the
dir is shared. Add it to the project's `.gitignore`:

```
.tmp/
```

## Tools

| Tool | Notes |
|---|---|
| `run_bash_container` | `devcontainer exec`, output returned inline. Brings the container up on demand. |
| `status` | look up one or more command ids |
| `wait` | block until any of several ids finishes/is rejected (mandatory timeout) |
| `kill` | cancel a pending or running command |
| `running` | list ids currently running |

`run_bash_container` accepts `background` (return an id immediately),
`after` (a list of command ids that must all succeed first), and `timeout`
(mandatory in the foreground, optional in the background). The clock starts
when the command actually begins running — after its `after` dependencies
clear — not at submission.

Projects that ship no devcontainer config get a minimal default
(`ubuntu:24.04` + a non-root `dev` user + host-timezone match), bundled with
the plugin at `assets/default-devcontainer.json` and passed via
`--override-config`.

There are no MCP tools for the host or for files: the host is reached through
the built-in `Bash` tool (see below), and files through the built-in
`Read`/`Write`/`Edit` tools (the project dir is shared, so no approval is
needed and they're the fast path).

## Host access and the built-in Bash gate

The built-in `Bash` tool runs on the host. A **PreToolUse** hook
(`hooks/gate-bash.mjs`) **denies** a built-in Bash call unless the command's
first line is `# NOT IN CONTAINER: <reason>`, where `<reason>` is a very short
sentence saying why it can't run in the container. This keeps routine shell
work in the free container and makes any genuine host command self-declare
with a justification. When a call is denied, the deny reason restates the
options (run it in the container; add the marker to run on the host; prefer
multiline over `&&`/`;`; avoid pipes; keep it auditable).

Host access therefore goes through Claude Code's own permission system for the
`Bash` tool, not a separate approval UI.

## Steering the workflow

Two hooks, both under `hooks/`:

- **`remind.mjs`** (SessionStart) — states the workflow once, up front, so the
  right tool is picked from the first turn without your having to say "use the
  split container plugin". It runs once per session rather than on every
  prompt, so it costs its tokens once instead of re-adding them each turn. It
  emits JSON with `hookSpecificOutput.additionalContext`; plain stdout is
  reported as a successful hook run but isn't injected, so a plain-text version
  would fail silently — `tests/hooks.test.ts` guards this.
- **`gate-bash.mjs`** (PreToolUse on `Bash`) — the enforcement described above.

Set `SPLIT_CONTAINER_ENFORCE=off` to disable both (the reminder emits nothing;
the gate allows Bash through normally). The hooks read the environment of the
`claude` process, so set it for the whole session
(`SPLIT_CONTAINER_ENFORCE=off claude …`), not per call.
