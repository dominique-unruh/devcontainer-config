#!/usr/bin/env bash
set -euo pipefail

# jq needed at postCreateCommand time (configure.sh) to merge statusLine
# into settings.json without clobbering other keys — installed here since
# that runs as remoteUser, no sudo. (apt dep feature already ran apt-get
# update.)
apt-get install --no-install-recommends -y jq git

# Marketplace/plugin install needs the real remoteUser's $HOME, not root's
# (install.sh runs as root at build time) — done in postCreateCommand
# instead, via configure.sh staged here.
install -D -m 0755 configure.sh /usr/local/share/devcontainer-config/caveman/configure.sh

# Feature options are only exposed as env vars here in install.sh (option
# id "mode" -> $MODE), never substitutable into devcontainer-feature.json
# fields like containerEnv — so the resolved value is handed to
# configure.sh (which runs later, at postCreateCommand time, in a fresh
# non-build shell with no access to $MODE) via a plain file instead.
echo -n "${MODE:-ultra}" > /usr/local/share/devcontainer-config/caveman/mode
