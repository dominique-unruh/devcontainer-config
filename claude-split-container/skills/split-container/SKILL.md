---
name: split-container
description: How to work when the claude-split-container MCP server is available — a free devcontainer (run_bash_container) that shares the project dir and is the default for shell work, plus a host that is reached only through the built-in Bash tool, gated by a hook. Use whenever a tool named run_bash_container from a claude-split-container MCP server is present and you need to run commands, edit files, or explore. Covers preferring the container, the `# NOT IN CONTAINER` marker for host commands, keeping host commands auditable, and the built-in-Bash-style background job model (run_in_background / bash_output / kill_shell).
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

Note: the project dir is accessible from the container and from the host and via builtin Read/Write commands.
But it has a different path (a) in the container and (b) on the host and for Read/Write/etc commands.
Always make sure you know what the host project path is (will usually be in your context), and what the
container path is (if unknown, you can use `pwd` in the container, for example).

Transfer of files between host and container possible through the project dir.
By convention, use .tmp/ subdirectory of the project dir for temporary files that need to be accessed on host and in container. 

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

IMPORTANT: Before running a host command, perform the following checks:

- Can it work in the container (possibly reformulated)?
- Can you split the command into a host-part and a container-part?
  (E.g., instead of `pdflatex test.tex; lpr test.pdf`, you would run pdflatex in the container, and then lpr on the host)
- Can you simplify the host command by piping input/output from/into .tmp/ and processing the input/output in the container?
- Did you get confused about the location of the project directory?
  (E.g., you are going to the host because you are want to process `/home/username/myproject/file.txt`,
  and you cannot find this path in container, but only reason is: the path would be e.g. `/workspace/file.txt`)
- Check whether the `NOT IN CONTAINER` comment (see below) explains the need of **every** line.

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
- Separate < or > piping by newline, except for very short commands. Like:
  ```
  command \
    > file
  ```
- Don't bundle unrelated work into one host call. One command per coherent
  action is easier to reason about.
- Avoid host-side constructs that hide what will actually run: command
  substitution feeding another command, `curl … | sh`, `eval`, and so on.

## The job model (`run_bash_container`)

The tool surface mirrors Claude Code's own built-in `Bash` / `BashOutput` /
`KillShell` — same parameters, same background model, just running in the
container. `run_bash_container` takes `command`, an optional `description`,
`run_in_background`, and `timeout` in **milliseconds** (optional; default
120000, max 600000).

- Foreground (the default) blocks and returns the command's output inline.
  `timeout` bounds this call.
- `run_in_background: true` returns a **shell id** immediately instead of
  blocking. Fire several independent commands up front, then collect their
  output as they run. A background command runs until it finishes or is
  killed (the foreground `timeout` doesn't bound it).
- `bash_output(bash_id, filter?)` reads a background shell's output — only
  what's **new** since your last read — along with its status and, once it
  has exited, its exit code. `filter` is an optional regex keeping only
  matching lines. Poll it to follow a long-running command.
- `kill_shell(shell_id)` kills a running background shell.
- `wait(bash_id, timeout)` blocks until that shell finishes or `timeout`
  **milliseconds** elapse, then reports its status/exit code (it doesn't
  consume the output buffer — read that with `bash_output`). Use it instead of
  polling `bash_output` in a loop when you just need to block until done.
- `list_background_running()` lists the background shells still running.

There's no cross-command dependency/ordering mechanism: to order work, either
run it foreground (each call blocks until done), chain it inside one `command`
script, or fire a background shell and `wait` on it before starting the next.

## Starting the container

`run_bash_container` brings the devcontainer up on demand (`devcontainer up`)
the first time it's used, so you don't have to. A project that ships no
devcontainer config gets a minimal default (`ubuntu:24.04` + a non-root `dev`
user + host-timezone match).

If it seems the container itself is down, or has no network, or some other error
that seems unrelated to the specific command you are running, inform the user of
the exact problem instead of just switching to host.
The user will usually be able to fix the problem or instruct you.
