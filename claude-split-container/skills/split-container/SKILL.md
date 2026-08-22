---
name: split-container
description: How to work when the claude-split-container MCP server is available — a gated host (every action needs human approval) plus a free devcontainer that shares the project dir. Use whenever tools named run_bash_host / run_bash_container / patch_file from a claude-split-container MCP server are present and you need to run commands, read/write/patch files, or explore. Covers preferring container over host, decomposing host commands so they're auditable, batching approvals via background jobs, and preferring patch over write.
---

# Working with a split host/container environment

Two execution targets, very different costs:

- **Container** (`run_bash_container`) — free. No approval, no prompt, no
  human in the loop. The container shares the project dir with the host,
  so files written on either side are visible to both.
- **Host** (`run_bash_host`, `read_file`, `write_file`, `patch_file`) —
  expensive. **Every** call blocks on a human reading it and clicking
  Approve or Reject. Their attention is the scarce resource.

Everything below follows from that asymmetry.

## The project dir is not "the host"

The project directory is shared between host and container and is the
work you were invited to do, so it needs no approval ceremony. **Use the
ordinary built-in `Read`/`Write`/`Edit`/`Glob`/`Grep` tools for files
inside the project dir** — they're the fastest path and edits are
immediately visible to the container too.

The MCP file tools exist for the *rest* of the host:

| Target | Use |
|---|---|
| Files in the project dir | built-in `Read`/`Write`/`Edit`/`Glob`/`Grep` |
| Host files outside the project dir | `read_file` / `write_file` / `patch_file` (approved) |
| Running anything | `run_bash_container`, or `run_bash_host` if it must be the host |

So the split is really about **commands** and about **host files outside
the project** — not about ordinary editing of the project you're working
on.

## Prefer the container

Default to `run_bash_container`. Only go to the host when the task
genuinely requires it:

- installing/configuring something on the host system itself
- reading host-only files (configs, credentials, things outside the project)
- host-specific tooling that isn't in the container
- inspecting host state (processes, services, hardware)

Anything else — builds, tests, greps, parsing, data munging, scratch
work — belongs in the container. In the container you may freely
`sudo apt-get install` whatever you need; it's disposable and exists only
for this work.

## Keep host commands simple and auditable

A human has to read each host command and decide, in seconds, whether
it's safe. Long pipelines are hard to audit; a person who can't quickly
follow what a command does will either rubber-stamp it (bad) or stall
(also bad).

So **decompose**. Do the host-only part on the host, then do the
processing in the container:

```
# Bad — one opaque host command
run_bash_host: some_sensitive_command | grep token | awk '{print $2}' | sort -u

# Good — host does only the host-only part...
run_bash_host: some_sensitive_command
#   -> writes .tmp/<ts>-<id>.stdout

# ...container does the rest, free and unaudited
run_bash_container: grep token .tmp/<ts>-<id>.stdout | awk '{print $2}' | sort -u
```

This is why `run_bash_host` writes stdout/stderr into `.tmp/` instead of
returning them: the output lands in the project dir, so the
follow-up costs nothing. And since `.tmp/` *is* in the project dir, the
built-in `Read`/`Grep` tools work on those files directly too — reach for
whichever is more convenient; neither needs approval.

Corollaries:

- **Separate multiple statements with newlines, not `;` or `&&`.** Each
  line then reads independently in the approval UI. (`run_bash_host` uses
  `bash -e`, so execution still stops at the first failure.)
- Don't bundle unrelated work into one host call to save a round trip —
  one call per coherent action is easier to approve or reject.
- Avoid host-side constructs that hide what will actually run: command
  substitution feeding another command, `curl … | sh`, `eval`, and so on.

## Prefer `patch_file` over `write_file`

This applies to host files **outside** the project dir — inside it, just
use the built-in `Edit` tool as normal.

For editing an existing text file out on the host, send a diff, not a
whole file. A diff shows exactly what changes; a full-file overwrite
forces the reviewer to diff it themselves or trust you. `patch_file` is
also atomic — it dry-runs first and restores a backup on failure, so a
patch that doesn't apply changes nothing.

Use `write_file` for new files, binary content, or a genuine
full-content replacement.

## Batch approvals with `background`

Every action tool takes `background: true`, which returns a command id
immediately — before approval even happens. Several backgrounded calls
therefore queue up in the approval UI **together**, so the human reviews
them in one sitting instead of being interrupted once per command.

Use this whenever you're exploring or have several independent host
actions: fire them all up front, then collect results.

```
run_bash_host(command: "...", background: true, timeout: 30)   -> id1
read_file(path: "...",        background: true)                -> id2
read_file(path: "...",        background: true)                -> id3
wait(ids: [id1, id2, id3], timeout: 300)
```

Then keep working in the container while approvals come in, rather than
blocking on them.

## Sequencing with `after`

`after: [id, ...]` makes a command wait until those commands have all
**succeeded**. If any dependency is rejected, or finishes with a non-zero
exit code / an error, the dependent is automatically rejected too, with a
note naming the cause — the failure cascades through the chain rather
than running the follow-up against a broken precondition.

Use it to submit a whole plan at once (all its approvals landing in the
UI together) while still guaranteeing order:

```
run_bash_host(command: "build something", background: true, timeout: 600) -> id1
run_bash_host(command: "use the build output", background: true, timeout: 60, after: [id1])
```

`after` works on foreground calls too — they'll block until the
dependencies finish.

## Write a real `reason`

Every host tool requires `reason` (markdown). It's the first thing the
human sees, and it's what makes a fast decision possible. State what
you're doing and why it needs the host — not a restatement of the
command.

- Bad: "Run a command"
- Bad: "Running `cat ~/.ssh/config`"
- Good: "Checking your SSH config for a `Host github.com` entry, to work
  out why the container's git push is failing. Needs the host because
  the container has no access to your `~/.ssh`."

If you can't articulate why it must be the host, that's a strong signal
it should be a container command instead.

## Managing running commands

- `status(ids)` — non-blocking check on one or more commands.
- `wait(ids, timeout)` — blocks until **any** of them reaches a terminal
  state; `timeout` is mandatory. Re-call with the remaining ids to wait
  for the rest.
- `running()` — ids of everything currently executing.
- `kill(id)` — cancel. Before it starts, this rejects it; while running,
  it terminates the process.

Timeouts on `run_bash_host`/`run_bash_container` are mandatory in the
foreground, optional in the background, and the clock starts when the
command actually begins running — not at submission — so a command can
sit awaiting approval indefinitely without burning its timeout.
