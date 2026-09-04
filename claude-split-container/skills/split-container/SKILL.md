---
name: split-container
description: How to work when the claude-split-container MCP server is available — a free devcontainer (run_bash_container) that shares the project dir and is the default for shell work, plus a host that is reached only through the built-in Bash tool, gated by a hook. Use whenever a tool named run_bash_container from a claude-split-container MCP server is present and you need to run commands, edit files, or explore. Covers preferring the container, the `# NOT IN CONTAINER` marker for host commands, keeping host commands auditable, and the background/after job model.
---

# Working with a split host/container environment

Two execution targets, very different costs:

- **Container** (`run_bash_container`) — free. No approval, no prompt. The
  container shares the project dir with the host, so files written on either
  side are visible to both. This is the **default** way to run any shell
  command.
- **Host** (the built-in `Bash` tool) — gated. A PreToolUse hook
  (`gate-bash.mjs`) **denies** a built-in Bash call unless its first line is
  `# NOT IN CONTAINER: <reason>`. Even then it runs on the host and is the
  slow, human-visible path.

Everything below follows from that asymmetry.

## Files: use the built-in tools

**Use the ordinary built-in `Read`/`Write`/`Edit`/`Glob`/`Grep` tools for
files.** The project dir is shared with the container, so edits are
immediately visible on both sides, and they're the fastest path. There are no
MCP file tools — file work is just the built-in tools.

The split is really about **commands**: which ones may run in the free
container and which genuinely need the host.

## Prefer the container

Default to `run_bash_container`. In the container you may freely
`sudo apt-get install` whatever you need; it's disposable and exists only for
this work. Builds, tests, greps, parsing, data munging, scratch work,
`git` operations on the project — all of it belongs in the container.

Only go to the host (built-in `Bash` with the marker) when the task genuinely
requires it:

- installing/configuring something on the host system itself
- host-specific tooling that isn't in the container (e.g. the `docker` /
  `devcontainer` CLIs, which live on the host)
- inspecting host state (processes, services, hardware)
- a network login or credential the container doesn't have

## Running a host command: the `# NOT IN CONTAINER` marker

To run on the host, make the **first line** of the built-in Bash command:

```
# NOT IN CONTAINER: <very short reason it can't run in the container>
```

The `<reason>` is a very short sentence stating why the container can't do it
— it's what justifies escaping the default to a human reading the command. If
you can't articulate a reason, that's a strong signal it should be a
`run_bash_container` call instead. Examples:

```
# NOT IN CONTAINER: needs the host docker daemon
docker ps
```

```
# NOT IN CONTAINER: pushes over the host's ssh credentials
git push
```

Without that first line the hook denies the call and reminds you of these
rules.

## Keep host commands simple and auditable

A host command runs where a human can see it, so keep it easy to follow:

- **Prefer a multiline command — one statement per line — over chaining with
  `&&` / `;`.** Each line then reads independently. (Built-in Bash uses
  `bash`, so keep in mind it does not stop at the first failure the way
  `bash -e` would; write commands that fail loudly if that matters.)
- **Avoid pipe constructions.** Instead of `command | grep ...`, write
  `command > .tmp/output` on the host, then run `grep ... .tmp/output` as a
  free `run_bash_container` command. `.tmp/` is in the shared project dir, so
  the container (and the built-in `Read`/`Grep` tools) can read it with no
  ceremony — do the host-only part on the host, the processing in the
  container.
- Don't bundle unrelated work into one host call. One command per coherent
  action is easier to reason about.
- Avoid host-side constructs that hide what will actually run: command
  substitution feeding another command, `curl … | sh`, `eval`, and so on.

## The job model (`run_bash_container`)

`run_bash_container` returns a **command record** with an id. `background`,
`after`, `status`, `wait`, `kill`, and `running` manage these records.

- `background: true` returns an id immediately instead of blocking. Fire
  several independent commands up front, then collect results — keep working
  while they run.
- `after: [id, ...]` makes a command wait until those commands have all
  **succeeded** (exit code 0). If any dependency fails or is killed, the
  dependent is auto-rejected with a note naming the cause, cascading through
  the chain. Use it to submit a whole ordered plan at once.
- `status(ids)` — non-blocking lookup. `wait(ids, timeout)` — block until any
  of them reaches a terminal state (`timeout` mandatory; re-call with the
  rest). `running()` — ids currently executing. `kill(id)` — cancel a pending
  or running command.

Timeouts on `run_bash_container` are mandatory in the foreground, optional in
the background, and the clock starts when the command actually begins running
(after its dependencies clear), not at submission — so a command can sit
waiting on `after` without burning its timeout.

## Starting the container

`run_bash_container` brings the devcontainer up on demand (`devcontainer up`)
the first time it's used, so you don't have to. A project that ships no
devcontainer config gets a minimal default (`ubuntu:24.04` + a non-root `dev`
user + host-timezone match).
