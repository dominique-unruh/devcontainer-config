# claude-split-container

MCP server for dual-environment Claude Code work: gated, human-approved
access to the **host** machine, and free (no-approval) access to the
project's **devcontainer**. See `PLAN.md` for the full design.

## Requirements

- Node.js (for running the server itself).
- [`@devcontainers/cli`](https://github.com/devcontainers/cli) installed
  and on `PATH` (`npm i -g @devcontainers/cli`) — used for `run_bash_container`.
- POSIX `patch` on `PATH` — used for `patch_file`.
- Optionally, a system webview component for the approval UI's standalone
  window. **Heads-up:** the bundled `webview` binary links
  `libwebkit2gtk-4.0`, which current distros (Arch, Ubuntu 24.04, …) have
  replaced with 4.1 — so on an up-to-date Linux box the native window
  usually *won't* start unless you install the older 4.0 runtime.
  That's handled, not fatal: the server automatically falls back to
  opening the dashboard in your default browser, and only if *that* also
  fails does the tool call return an error (containing the dashboard URL,
  so you can still open it by hand). WebView2 on Windows and WKWebView on
  macOS are present by default and work as-is.

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

## Shared directory

The shared directory is the project dir's `.tmp/` subfolder — add it to
the project's `.gitignore`:

```
.tmp/
```

## Tools

| Tool | Approval | Notes |
|---|---|---|
| `run_bash_host` | required | `bash -e -c`, stdout/stderr written to `.tmp/*.stdout`/`.stderr` |
| `read_file` | required | copies a host file into `.tmp/` |
| `write_file` | required | writes a `.tmp/` file or literal content to a host path |
| `patch_file` | required | applies a unified diff, atomically (dry-run first, backup + restore on failure) |
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

If the native window can't start (see Requirements), the server falls
back to opening that URL in your default browser. If that fails too, the
tool call returns an error containing the URL rather than hanging — the
command stays queued, so opening the URL by hand and approving still runs
it, and `status`/`wait` on the returned id picks up the result.

## Enforcing the workflow

The skill alone only *suggests* this workflow, so Claude tends to reach
for the built-in `Bash`/`Read`/`Edit` tools out of habit and you end up
saying "use the split container plugin" by hand. The plugin therefore
ships two hooks that make it automatic:

- a **PreToolUse** hook that denies the built-in host tools and names the
  MCP tool to use instead, and
- a **UserPromptSubmit** hook that states the workflow up front, so the
  right tool is chosen from the first turn rather than after a denial.

Control the scope with `SPLIT_CONTAINER_ENFORCE`:

| Value | Effect |
|---|---|
| `all` (default) | block `Bash`/`BashOutput`/`KillShell` **and** `Read`/`Write`/`Edit`/`NotebookEdit`/`Glob`/`Grep` |
| `bash` | block only the Bash tools; built-in file tools keep working |
| `off` | disable both hooks entirely |
