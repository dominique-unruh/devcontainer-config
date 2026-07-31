#!/usr/bin/env bash
set -euo pipefail
export ELAN_HOME="${ELAN_HOME:-/usr/local/lean/elan}"
export PATH="${ELAN_HOME}/bin:${PATH}"

# Runs as remoteUser with cwd = the workspace folder, per devcontainer
# lifecycle-command conventions, so a relative path is enough.
toolchain_file="./lean-toolchain"
if [ -f "$toolchain_file" ]; then
  toolchain="$(tr -d '[:space:]' < "$toolchain_file")"
  elan toolchain list | grep -qF "$toolchain" || elan toolchain install "$toolchain"
fi
