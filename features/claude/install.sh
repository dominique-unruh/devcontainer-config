#!/usr/bin/env bash
set -euo pipefail

# settings.json merge in configure.sh needs jq, and needs the real
# remoteUser's $HOME, not root's — install.sh runs as root at build time,
# so only the package install happens here; the merge itself is deferred
# to postCreateCommand via configure.sh, staged below.
apt-get install --no-install-recommends -y jq

# Official feature's `npm install -g` leaves the package dir root-owned
# even though the rest of nvm's node_modules tree is dev:nvm group-writable
# -- breaks Claude Code's self-update (runs as remoteUser later). Align it
# with the rest of the tree instead of leaving it root-only.
pkg_dir="$(npm root -g)/@anthropic-ai"
[ -d "$pkg_dir" ] && chmod -R g+w "$pkg_dir"

install -D -m 0755 configure.sh /usr/local/share/devcontainer-config/claude/configure.sh

# Feature options are only exposed as env vars here in install.sh (option
# id "dangerousPermissions" -> $DANGEROUSPERMISSIONS), never substitutable
# into devcontainer-feature.json fields — so the resolved value is handed
# to configure.sh via a plain file instead, same as caveman's "mode".
echo -n "${DANGEROUSPERMISSIONS:-false}" > /usr/local/share/devcontainer-config/claude/dangerous-permissions
