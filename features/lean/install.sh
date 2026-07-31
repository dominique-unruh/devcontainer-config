#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install --no-install-recommends -y curl ca-certificates

# Installed system-wide (not into $HOME, which is /root at build time)
# under a fixed ELAN_HOME so it's usable by whichever user ends up as
# remoteUser, and so this step is a cached Docker layer independent of
# repo content. World-writable so a non-root remoteUser created by a
# separate "user" feature (unordered relative to this one) can still
# `elan toolchain install` into it later — devcontainers are single-user
# dev environments, not a security boundary, so this tradeoff is fine.
export ELAN_HOME=/usr/local/lean/elan
mkdir -p "$ELAN_HOME"
curl https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh -sSf \
  | sh -s -- -y --default-toolchain none --no-modify-path
chmod -R a+rwX "$ELAN_HOME"

# vm.max_map_count tuning (mathlib mmaps thousands of .olean files) is a
# host-kernel setting a Feature can't apply from inside install.sh — would
# need runArgs: ["--sysctl", "vm.max_map_count=..."] in the consuming
# project's own devcontainer.json. Deferred, see PLAN.md.

install -D -m 0755 configure.sh /usr/local/share/devcontainer-config/lean/configure.sh
