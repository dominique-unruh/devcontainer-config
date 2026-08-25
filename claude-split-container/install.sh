#!/usr/bin/env bash
# Install claude-split-container into the local Claude Code, or refresh an
# existing installation in place.
#
# `claude plugin install` snapshots the plugin directory into a versioned cache
# (~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/) rather than
# referencing this tree, so the build has to happen before the copy — hence the
# npm steps below. The snapshot does include `dist/` and `node_modules/` even
# though both are gitignored.

set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# This directory is both the marketplace and the one plugin in it — marketplace.json
# and plugin.json share the single .claude-plugin/, with the plugin sourced as "./".
MARKETPLACE_DIR="$PLUGIN_DIR"

SCOPE=user
BUILD=1

usage() {
  cat <<EOF
Usage: $(basename "$0") [--scope user|project|local] [--no-build]

Installs the claude-split-container plugin into the local Claude Code, or
refreshes it if it is already installed.

  --scope <scope>  Installation scope (default: user).
  --no-build       Skip 'npm install' and 'npm run build'. Only safe when
                   dist/ is already current — the installer copies the tree
                   as it stands, so a stale dist/ gets installed silently.
  -h, --help       Show this help.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --scope) SCOPE="${2:?--scope needs a value}"; shift 2 ;;
    --scope=*) SCOPE="${1#*=}"; shift ;;
    --no-build) BUILD=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "$(basename "$0"): unknown argument '$1'" >&2; usage >&2; exit 2 ;;
  esac
done

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "install.sh: '$1' is not on PATH — $2" >&2
    exit 1
  }
}
need claude "install Claude Code first"
need node "the MCP server runs on Node.js"
need npm "needed to build the server"

# Read a top-level string field out of a JSON file, so the marketplace and
# plugin names stay defined in one place (their manifests) rather than here.
json_field() {
  node -e '
    const fs = require("node:fs");
    const [file, key] = process.argv.slice(1);
    const value = JSON.parse(fs.readFileSync(file, "utf8"))[key];
    if (typeof value !== "string" || !value) {
      console.error(`install.sh: ${file} has no usable "${key}"`);
      process.exit(1);
    }
    process.stdout.write(value);
  ' "$1" "$2"
}

MARKETPLACE_MANIFEST="$MARKETPLACE_DIR/.claude-plugin/marketplace.json"
PLUGIN_MANIFEST="$PLUGIN_DIR/.claude-plugin/plugin.json"
[ -f "$MARKETPLACE_MANIFEST" ] || { echo "install.sh: missing $MARKETPLACE_MANIFEST" >&2; exit 1; }
[ -f "$PLUGIN_MANIFEST" ] || { echo "install.sh: missing $PLUGIN_MANIFEST" >&2; exit 1; }

MARKETPLACE="$(json_field "$MARKETPLACE_MANIFEST" name)"
PLUGIN="$(json_field "$PLUGIN_MANIFEST" name)"
PLUGIN_ID="$PLUGIN@$MARKETPLACE"

# True when PLUGIN_ID is already installed at SCOPE.
plugin_installed() {
  claude plugin list --json 2>/dev/null | node -e '
    const [id, scope] = process.argv.slice(1);
    let raw = "";
    process.stdin.on("data", (d) => (raw += d));
    process.stdin.on("end", () => {
      let list = [];
      try { list = JSON.parse(raw); } catch { /* no plugins yet, or not JSON */ }
      const found = Array.isArray(list) && list.some((p) => p.id === id && p.scope === scope);
      process.exit(found ? 0 : 1);
    });
  ' "$PLUGIN_ID" "$SCOPE"
}

if [ "$BUILD" -eq 1 ]; then
  echo "==> Building $PLUGIN"
  (cd "$PLUGIN_DIR" && npm install --silent && npm run build)
else
  echo "==> Skipping build (--no-build)"
fi
[ -f "$PLUGIN_DIR/dist/server.js" ] || {
  echo "install.sh: $PLUGIN_DIR/dist/server.js is missing — run without --no-build." >&2
  exit 1
}

# Idempotent: re-adding an already-declared marketplace is a no-op, so this
# needs no guard.
echo "==> Registering marketplace '$MARKETPLACE' ($MARKETPLACE_DIR)"
claude plugin marketplace add "$MARKETPLACE_DIR" --scope "$SCOPE"

if plugin_installed; then
  # Not `claude plugin update`: that compares manifest versions and no-ops when
  # they match, which is the normal case when installing from a working tree
  # whose version rarely changes. Uninstall + install forces a fresh snapshot.
  echo "==> '$PLUGIN_ID' is already installed at scope $SCOPE — refreshing it"
  claude plugin uninstall "$PLUGIN_ID" --scope "$SCOPE"
  claude plugin install "$PLUGIN_ID" --scope "$SCOPE"
else
  echo "==> Installing '$PLUGIN_ID' at scope $SCOPE"
  claude plugin install "$PLUGIN_ID" --scope "$SCOPE"
fi

INSTALL_PATH="$(claude plugin list --json 2>/dev/null | node -e '
  const [id] = process.argv.slice(1);
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    let list = [];
    try { list = JSON.parse(raw); } catch { /* fall through to the empty check */ }
    const hit = Array.isArray(list) ? list.find((p) => p.id === id) : undefined;
    process.stdout.write(hit?.installPath ?? "");
  });
' "$PLUGIN_ID")"

if [ -z "$INSTALL_PATH" ] || [ ! -f "$INSTALL_PATH/dist/server.js" ]; then
  echo "install.sh: install reported success but $INSTALL_PATH/dist/server.js is missing." >&2
  exit 1
fi

cat <<EOF

Installed: $PLUGIN_ID
  from: $PLUGIN_DIR
  to:   $INSTALL_PATH

Restart Claude Code to pick it up.

Approval happens inside the server's own dashboard, not through Claude Code's
permission prompts, so allow its tools to be called:

  // settings.json
  { "permissions": { "allow": ["mcp__plugin_${PLUGIN}_split__*"] } }

Re-run this script after changing the source: the installed copy is a snapshot,
so edits here do not reach it until you do.
EOF
