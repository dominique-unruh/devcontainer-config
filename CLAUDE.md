# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A CLI (`devcontainer-config`) plus a library of composable [devcontainer
Features](https://containers.dev/implementors/features/), analogous to
`../vagrant-config` but targeting devcontainers instead of Vagrant. It
scaffolds a project's `.devcontainer/`, vendors chosen features into it by
copy (not by package-manager dependency, so the vendored copy is
self-contained and diffable in the consuming repo), and lets you interactively
configure/update/delete them afterward.

`PLAN.md` is the original design doc and background rationale (why native
devcontainer Features instead of porting the Ruby snippet pattern verbatim,
why plain `ubuntu:24.04`, etc.) — read it for the "why". It has drifted from
the implementation in some places though (e.g. it still describes git-revision-
based provenance and doesn't mention external-feature support or the
`check`/`update` subcommands), so treat the code as ground truth over PLAN.md
when they disagree.

## Commands

- `npm run build` — bundles `src/cli.ts` into `dist/devcontainer-config`
  (single file, `esbuild`, `--packages=external` so `commander`/`prompts`
  resolve from `node_modules` at runtime rather than being inlined —
  `dist/devcontainer-config` therefore only runs from inside this repo tree,
  not standalone). **Run this after every source change** — there's no
  watch mode. `dist/` is gitignored.
- `npm run typecheck` — `tsc --noEmit`. No lint script configured.
- `npm run dev` — runs `src/cli.ts` directly via `tsx`, no build step.
- No automated test suite exists. Verification so far has been manual
  smoke-testing (`init`/`add`/`config`/`check`/`update`) in scratch
  directories outside the repo.
- Try the CLI on itself: this repo's own `.devcontainer/` was scaffolded by
  its own tool (`./dist/devcontainer-config check` from the repo root should
  pass).

## Architecture

### Feature library (`features/`)

Each subdirectory is one feature, in one of two kinds, distinguished by
whether `meta.json` has an `external` key:

- **Local** (`user`, `caveman`, `lean`, `claude`, `apt`): a real
  `devcontainer-feature.json` + `install.sh`, vendored in full (whole
  directory copy) into a consuming project's `.devcontainer/features/<name>/`
  and referenced in its `devcontainer.json` as `"./features/<name>"`. `claude`
  adds this repo's own config on top of the official Claude Code CLI feature
  (currently: a `dangerousPermissions` option that sets
  `permissions.defaultMode: bypassPermissions` in the real dev user's
  `~/.claude/settings.json`) — it `dependsOn` the official feature's OCI ref
  directly (see below), rather than this repo wrapping/tracking that ref as
  its own local- or external-kind feature.
- **External**: not currently used by any feature in this repo (no
  `devcontainer-feature.json`/`install.sh` at all — just a `meta.json` with
  `external: {ref, description, options}` pointing at a public/OCI-published
  feature this repo doesn't own). Still a supported kind in `src/lib/`; add
  one back if some future feature needs its own `deps`/`tests`/options
  tracked against an external ref (`claude`'s dependency on the official
  Claude Code feature doesn't need this: it only needs `dependsOn`, not
  option tracking, since it exposes no options of the wrapped feature).

`meta.json` is a sidecar file **only this tool reads** — the devcontainer CLI
never sees it, so it's free to hold whatever's useful:
- `deps`: other feature names this one requires, driving `add`'s own
  recursive dependency walk (`src/lib/deps.ts`) — this is what this tool
  itself uses to decide vendoring/ordering when running `add`/`update`.
  It's a separate, parallel declaration from `devcontainer-feature.json`'s
  own `dependsOn` (see below): `deps` need not name a feature the same way
  `dependsOn` does (e.g. `apt`, not `./apt`), since it's just this tool's
  own name-to-name graph, not something the devcontainer CLI reads.
- `tests`: static checks run against the project's resolved
  `devcontainer.json`, of kind `incompatibleWith`, `dependsOnOptions`, or
  `custom` (a vendored `.mjs` script, dynamically imported, receiving the
  whole config — see `features/user/validate-remote-user.mjs` for an
  example that cross-checks `devcontainer.json`'s `remoteUser` against the
  `user` feature's `username` option).
- `provenance` (vendored copies only, never in source): content hash used
  for update detection — see below.

Because there's no `devcontainer-feature.json` schema for external features,
their description/options for `config`'s UI live in `meta.json`'s
`external.options` instead — `src/lib/featureSource.ts`'s `readManifest()`
is the one place that reads "description + options schema" uniformly for
either kind; nothing else should read `devcontainer-feature.json` directly.

### Build-time vs runtime split (local features only)

`install.sh` always runs **as root at Docker build time**, regardless of the
project's configured `remoteUser` — so anything that needs the actual dev
user's `$HOME` (writing `~/.claude/settings.json`, installing a Claude Code
plugin into the user's plugin dir, etc.) can't happen in `install.sh`.
The pattern used throughout (`claude`, `caveman`, `lean`): `install.sh` does
the cacheable, user-independent, build-time work, then stages a sibling
`configure.sh` to a fixed system path (e.g.
`/usr/local/share/devcontainer-config/<feature>/configure.sh`) and points
`devcontainer-feature.json`'s `postCreateCommand` at it — that hook runs
later, after the container exists, as the real `remoteUser`, with the repo
mounted. `lean` additionally uses this split for its actual purpose (install
elan at build time; read the mounted repo's `lean-toolchain` at
`postCreateCommand` time).

Features that need another feature's build-time work done first (e.g.
`apt`'s `apt-get update` before anyone `apt-get install`s, or `claude`'s
Claude Code CLI installed before `caveman`'s plugin install) declare it
in `devcontainer-feature.json`'s real `dependsOn` (keyed by the dependency's
actual devcontainer-spec ref: `"./apt"` for a sibling local feature,
the full OCI ref for an external one) — this is enforced by the real
devcontainer CLI at build time, unlike `meta.json`'s `deps` (this tool's
own bookkeeping only). Both get declared for a dependency that's local:
`meta.json`'s `deps` so this tool's own `add`/`update` vendor it, `dependsOn`
so the actual Docker build installs it first regardless of key order in
`devcontainer.json`'s `features` map.

### Update detection: content hash, not git revision

Vendored copies are checked for staleness by content hash, not by comparing
git commits — this repo may have no commits at all and the mechanism still
works. `src/lib/provenance.ts` computes:
- `hashDirectory()` for local features (hash of every file's path+bytes in
  the source feature dir), stamped as a comment on the vendored `install.sh`
  (must go *after* a leading shebang, since a shebang must be a file's first
  line to execute).
- `hashFile()` for external features (hash of the source `meta.json`
  itself), stored as a real JSON `provenance` field in the vendored copy
  (no `install.sh` exists to comment).

`src/lib/update.ts` recomputes the current source hash and compares.
`src/lib/git.ts`'s `sourceRemote()` is cosmetic only (shown in messages),
not used for staleness.

### devcontainer.json feature keys

A feature's key in `devcontainer.json`'s `"features"` map is never assumed —
always computed via `featureRefFor(name, meta)` (`src/lib/featureSource.ts`):
`"./features/<name>"` for local, the external `ref` string for external.
`src/lib/devcontainerJson.ts`'s accessors (`isFeatureInstalled`,
`getFeatureOptions`, `setFeatureOptions`, `removeFeature`) all take that
computed key directly, never a bare name — callers are responsible for
resolving name → key first (local vs. source meta.json for `add`, vs. the
project's *vendored* meta.json for `config`/`tests`, since by the time
`config`/`check` run, the feature is already vendored locally).

### `src/lib/` module map

- `paths.ts` — locates this repo's root by walking up from the running
  file looking for `package.json` + `features/` (works both under `tsx`
  from `src/` and the bundled `dist/devcontainer-config`).
- `featureSource.ts` — reads from *this repo's* `features/`: listing,
  `meta.json`, unified manifest (description/options for either kind).
- `deps.ts` — recursive `meta.json` `deps` walk (`resolveDeps`), dependency-
  before-dependent order, cycle detection.
- `vendor.ts` — copies a feature into a project's `.devcontainer/features/`,
  kind-aware (whole-dir copy + install.sh stamp for local, meta.json-only +
  JSON provenance field for external); refuses to overwrite an unmanaged
  destination; `addFeatures()` is `add`'s and `config`'s shared entry point.
- `devcontainerJson.ts` — read/write the *project's* `devcontainer.json`.
- `tests.ts` — runs every vendored feature's `meta.json` `tests` against the
  project's `devcontainer.json`; always a full sweep across all installed
  features, never scoped to one (a change to one feature's options can
  break another's test).
- `update.ts` — content-hash staleness checks (`checkUpdates`, dep-
  transitive; `listStaleInstalledFeatures`, not transitive, for the
  no-args interactive picker) and `applyUpdates`.
- `provenance.ts` — hashing + the install.sh stamp format.
- `git.ts` — cosmetic remote lookup only.

### `src/commands/*.ts` — CLI subcommands (thin, delegate to `lib/`)

- `init` — scaffold `devcontainer.json` (`ubuntu:24.04`) + auto-add `user`.
- `add <names...>` — vendor feature(s) + transitive deps.
- `config [name]` — interactive (uses `prompts`): picks a feature if none
  given (installed features sorted first), auto-adds if not yet vendored,
  edit options / check-for-updates / delete, full test sweep before and
  after any mutation.
- `check` — non-interactive full test sweep, non-zero exit on failure (same
  sweep `config` runs, usable standalone e.g. for CI).
- `update [names...] [--all]` — explicit names, `--all`, or an interactive
  multiselect over currently-stale installed features if given neither.

## Adding a new feature

1. New dir under `features/<name>/`.
2. Local: `devcontainer-feature.json` + `install.sh` (+ optional sibling
   `configure.sh` staged via `install.sh` and wired through
   `postCreateCommand` if it needs the real dev user — see above). External:
   just `meta.json` with `external: {ref, description, options}`.
3. `meta.json` `deps`/`tests` as needed (local features need `meta.json`
   too, even if just `{"deps": [], "tests": []}`).
4. No build step needed to pick up a new feature — `features/` is read
   directly from disk at runtime, not bundled into `dist/`.
