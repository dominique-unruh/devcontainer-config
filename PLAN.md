# devcontainer-config

Analog of `../vagrant-config`, targeting devcontainers instead of Vagrant.
Draft — edit freely.

## Goal

Same shape as vagrant-config: a library of small, composable, reusable
provisioning units ("snippets" there, "features" here), plus a CLI that
scaffolds a new project and vendors chosen units into it by copy (not by
package-manager dependency), so the vendored copy is self-contained and
diffable in the consuming repo.

## Architecture: native devcontainer Features

Devcontainers have a real spec for this (containers.dev "Features"), and
it's a better fit than porting the Ruby function/`require_relative`/
`$xxx_seen` pattern verbatim:

- Each unit lives in its own folder: `devcontainer-feature.json` (id,
  version, options schema, description) + `install.sh` (+ optionally
  `onCreateCommand` / `postCreateCommand` / etc. declared inside the JSON).
- `install.sh` runs at **image build time** — the devcontainer CLI builds
  the base image/Dockerfile, then layers one `RUN install.sh` per feature
  on top, in order. Normal Docker/BuildKit layer caching applies. This is
  strictly better than Vagrant's shell provisioners, which re-run in full
  on every `--provision` regardless of what changed.
- Lifecycle hooks declared in a feature's own `devcontainer-feature.json`
  (`onCreateCommand`, `postCreateCommand`, ...) run **after** the container
  is created and the repo is mounted at `/workspaces/<repo>`. Not cached,
  re-run per lifecycle rules. This is the right place for anything that
  needs repo content (e.g. `lean.rb` reading `lean-toolchain` off
  `/vagrant` — see the `lean` feature below).
- Features are referenced from `devcontainer.json`'s `"features"` map by
  **local relative path** (`"./features/claude": {}`) — no OCI
  registry/publish step needed, source lives directly in the consuming
  repo, same as `snippets/*.rb` living directly in `vagrant-config`.

## Dependency composition

The spec has a native hard-dependency mechanism (`dependsOn`, DAG-resolved
install order), but it's not fully verified here whether it behaves
consistently with local relativePath features across both the
`devcontainer` CLI and the VS Code Dev Containers extension. Treat as
**verify during implementation**, not a blocker.

Regardless of how well `dependsOn` works, `devcontainer-config add` does
its **own** recursive dependency walk — directly mirroring
`vagrant-config.py`'s `add_one()` / `snippet_deps()`. This is what makes
`caveman` pull in `claude` automatically (mirrors `caveman.rb`'s
`require_relative "claude.rb"`), guaranteed to work independent of spec
nuances, and gives us a hook to inject the same provenance header
vagrant-config.py writes on copy (remote/revision/path), plus wire the
default options for the pulled-in dependency into `devcontainer.json`.

Since `devcontainer-feature.json` is schema-validated JSON (no comments,
unlike a `.rb` file), provenance/dep metadata can't just be a comment atop
the file the way vagrant-config does it. Plan:
- `install.sh` (a real shell script) keeps the same provenance-comment
  trick vagrant-config.py already uses.
- Each feature folder also holds a **sidecar metadata JSON** (ours only,
  never read by the devcontainer CLI, no schema risk) — this replaces the
  earlier plain-text `DEPS` idea with a single structured file. Contents:
  - `deps`: list of feature names this one requires (subsumes `DEPS`,
    drives `devcontainer-config`'s own recursive dependency walk).
  - `tests`: static config checks, run by `devcontainer-config` against
    the project's resolved `devcontainer.json` at `add`/`config` time
    (before any Docker build). Each test is one of:
    - a built-in check kind, e.g. "all options this feature's `dependsOn`
      requests are actually present with those values on the depended-on
      feature", or "incompatible with feature X" (this subsumes what would
      otherwise be a separate `incompatibleWith` field — it's just another
      built-in test kind, not special-cased).
    - an arbitrary custom JS/TS validator function that receives the whole
      resolved config and returns pass/fail + a message. Since the CLI
      itself is TypeScript/Node (see below), custom validators run
      in-process — no shelling out to a separate interpreter.
  - Exact schema/field names TBD; naming for the file itself also TBD
    (e.g. `meta.json` alongside `devcontainer-feature.json`/`install.sh`).
  - Vendored into the consuming project on `add`, same as
    `devcontainer-feature.json`/`install.sh` — not left behind in the
    source repo only. `config` needs `deps`/`tests` available locally to
    validate without requiring this source repo to be present/checked out.

## CLI tool: devcontainer-config (TypeScript)

Mirrors `vagrant-config.py`'s subcommands, plus a new `config` one. Written
in TypeScript (Node already a hard dependency via the `devcontainer` CLI
itself, and lets the sidecar metadata's custom JS/TS validators run
in-process). Invoked as `devcontainer-config`, no file extension — a
compiled/bundled executable with a `node` shebang, like any npm-installed
bin, not run via `ts-node`/ `node foo.ts` directly.

- **`init`**: scaffold `.devcontainer/devcontainer.json` (base image plain
  `ubuntu:24.04`, vendor-neutral, same philosophy as vagrant-config's
  `bento/ubuntu-26.04` — rejected `mcr.microsoft.com/devcontainers/base:ubuntu`
  as too vendor-specific despite its convenience of a preinstalled non-root
  user; we add our own `user` feature instead, see v1 scope) +
  `.devcontainer/features/` dir (mirrors `.vagrant-config/`). No wrapper
  script for now (`scripts/devcontainer.sh` is deferred, see below).
- **`add <name...>`**: copy feature folder(s) from this repo's `features/`
  into the project's `.devcontainer/features/<name>/`, walk the sidecar
  metadata JSON's `deps` recursively, read-modify-write `devcontainer.json`'s
  `"features"` map to
  add an entry per feature (unlike Vagrant's `Dir[...].each { require }`,
  there's no auto-pickup — every feature must be explicitly listed), and
  refuse to clobber a destination not stamped as ours (same
  managed-file check as `vagrant-config.py`'s `add_one`).
- **`config [name]`**: interactive TUI to edit a feature's options in
  place. Behavior:
  - On startup, before anything else: run **all** `tests` from **all**
    locally vendored features' sidecar metadata (not just `<name>`'s) —
    a change to one feature's options can break another installed
    feature's test (e.g. a `dependsOn`-option check, or an
    `incompatibleWith`-style check). Report failures up front.
  - After any mutation this run performs (option edit written, feature
    auto-added, feature updated, feature deleted), re-run the full test
    sweep again (same as above — all tests, all locally vendored
    features), and report the result before exiting.
  - Called with no `name`: TUI lists all available features (installed and
    not-yet-installed, from this repo's `features/`), user picks one, then
    proceeds as below.
  - If `<name>` isn't vendored into the project yet, run the same logic as
    `add <name>` first (including its transitive deps), then continue —
    `config` never requires a separate `add` step first.
  - Reads the feature's `devcontainer-feature.json` `"options"` schema
    (type/default/description/enum per option) plus whatever's currently
    set in the project's `devcontainer.json` `"features"` entry for it,
    prompts through each option (Enter keeps current/default value), and
    writes the result back into `devcontainer.json`.
  - Separately checks for updates: compares the provenance revision
    recorded in the vendored copy (see provenance-header mechanism above)
    against this repo's current revision for that feature **and all of
    its transitive deps**. If any are behind, print the full list (name:
    old revision → new revision) before asking to update, and on
    confirmation update all of them in one go, not just `<name>`
    — since a stale dependency can matter even if `<name>` itself is
    current. Preserves the user's existing option values already stored
    in `devcontainer.json` when re-vending the updated copy.
  - Offers a **delete** action for an already-installed feature: removes
    its entry from `devcontainer.json`'s `"features"` map and deletes its
    vendored folder under `.devcontainer/features/<name>/`. If other
    installed features list it as a dependency (via the sidecar metadata's
    `deps`), warn and ask for confirmation before deleting (or refuse —
    TBD), since removing it out from under a dependent would silently
    break that dependent's next build.
- Shell completion (TS CLI framework equivalent of `argcomplete`, e.g.
  `yargs`/`commander` completion support) + a `snippet_list_epilog`-
  equivalent that lists available features with their
  `devcontainer-feature.json` `"description"`.

## scripts/devcontainer.sh (deferred, not v1)

Not yet decided whether this is wanted at all — VS Code's Dev Containers
extension already covers most of this interactively, so the value of a
CLI wrapper is less clear-cut than `vagrant.sh` was for `vagrant`. Sketch
kept below for reference, not scoped for v1.

Wrapper around the `devcontainer` CLI (`@devcontainers/cli` npm package),
playing the role `vagrant.sh` plays for `vagrant`:

- `update` — rebuild image (cache-aware) + up
- `rebuild` — tear down + up with no cache reuse
- `restart` — restart the existing container
- `ssh` — `devcontainer exec bash`
- default — `devcontainer exec -- "$@"`

Exact `devcontainer` CLI invocations TBD during implementation.

## v1 feature scope (starter set)

- **user** — creates a non-root user + `sudo` in the plain `ubuntu:24.04`
  base (which, unlike `mcr.microsoft.com/devcontainers/base:ubuntu`,
  doesn't ship one). No vagrant-config equivalent (Vagrant boxes already
  have a non-root user). `init` wires `devcontainer.json`'s `remoteUser`
  to match.
- **claude** — install Claude Code CLI. Direct port of `claude.rb`,
  `install.sh` only, no repo-mount step needed.
- **caveman** — install caveman plugin, set default mode. Depends on
  `claude` (via sidecar metadata `deps` + optionally `dependsOn`). Direct
  port of
  `caveman.rb`.
- **lean** — install elan in `install.sh` (build-time, cached, no repo
  needed); read `/workspaces/<repo>/lean-toolchain` and install the pinned
  toolchain in `postCreateCommand` (repo-mounted, uncached). Splits
  `lean.rb` cleanly across the build/runtime boundary.
- **apt** — shared install/update helper. Open design question: does this
  become its own tiny feature other features `dependsOn`, or a plain shell
  helper `install.sh` scripts `source`, given every feature's `install.sh`
  already runs as root during build and apt state doesn't need the
  `$apt_update_seen`-style guard Vagrant needed (each feature is its own
  Docker layer, so redundant `apt-get update` calls are cheap/cached
  per-layer anyway, not a correctness issue like it was for accumulating
  shell provisioners in one VM).
- **command** — `command.rb`'s job (register a named script into
  `~/.local/bin`, deduped, with a "same content or error" guard across
  callers) may not need a runtime port at all: each feature's `install.sh`
  can just write its own scripts directly, and the cross-feature name-clash
  guard existed in vagrant-config because all provisioners share one VM's
  provisioner list — features don't have that shared-registration problem.
  Revisit only if a concrete need shows up.

## Deferred (not built in v1)

- **pip, sbt, scalapy** — same pattern as `lean`/`claude`, port later,
  no blockers.
- **resources.rb (`memory_min`)** → `hostRequirements.memory` in
  `devcontainer.json`. Declarative, array-merge-of-max semantics carry
  over directly, no need for vagrant's read-back-via-scan hack (VBoxManage
  customizations are write-only; `hostRequirements` is just a JSON value).
- **arch.rb (`enforce_amd64`)** → `runArgs: ["--platform=linux/amd64"]`
  or the build `"platform"` option in `devcontainer.json`.
- **vscode.rb** → obsoleted entirely. VS Code runs on the host and attaches
  to the container; extensions are declared natively via
  `customizations.vscode.extensions` in `devcontainer.json`, no install
  script required. Nothing to port.
- **x11.rb** → different mechanism in container-land (mount the host's X11
  socket + set `DISPLAY`, vs. Vagrant's sshd `X11Forwarding`). Open
  question, not scoped for v1.

## Open questions to resolve during implementation

- Does `dependsOn` reliably pull in local relativePath features across
  both the `devcontainer` CLI and VS Code's Dev Containers extension? Not
  blocking (CLI-level dep walk covers it either way) but worth confirming
  so `devcontainer-config add` can skip writing an explicit
  `"features"` entry for auto-pulled deps if `dependsOn` already covers it.
- Exact `devcontainer` CLI subcommands/flags for
  `update`/`rebuild`/`restart` in `scripts/devcontainer.sh` — needs a pass
  against the current `@devcontainers/cli` version once written.
