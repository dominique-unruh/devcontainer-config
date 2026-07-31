#!/usr/bin/env bash
# Installed using devcontainer-config from <no remote>, dir features/claude, content-hash 57f101879889ff54e3199be135b1eaa255729684727bfaf13ae2b07bfd08aa6d
set -euo pipefail

# settings.json merge in configure.sh needs jq, and needs the real
# remoteUser's $HOME, not root's — install.sh runs as root at build time,
# so only the package install happens here; the merge itself is deferred
# to postCreateCommand via configure.sh, staged below.
apt-get install --no-install-recommends -y jq

install -D -m 0755 configure.sh /usr/local/share/devcontainer-config/claude/configure.sh

# Feature options are only exposed as env vars here in install.sh (option
# id "dangerousPermissions" -> $DANGEROUSPERMISSIONS), never substitutable
# into devcontainer-feature.json fields — so the resolved value is handed
# to configure.sh via a plain file instead, same as caveman's "mode".
echo -n "${DANGEROUSPERMISSIONS:-false}" > /usr/local/share/devcontainer-config/claude/dangerous-permissions
