#!/usr/bin/env bash
# Installed using devcontainer-config from https://github.com/dominique-unruh/devcontainer-config.git, dir features/claude, content-hash 06110b844641926f8b1cbdb02dc438efd39d0a29eb27e95545112e787d41ce72
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
