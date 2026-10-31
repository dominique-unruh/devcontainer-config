#!/usr/bin/env bash
# Installed using devcontainer-config from https://github.com/dominique-unruh/devcontainer-config.git, dir features/apt, content-hash f9eb789c25cf941d2650c4827aad242aa90549a96df452e781c7f223e8da126c
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

packages="${PACKAGES:-}"

# Hotfix: under podman, some features' build layers end up with /tmp as
# 0755 instead of 1777 (cause unknown), and apt's signature check runs as
# the unprivileged _apt user, which then can't create its temp files
# ("Couldn't create temporary file /tmp/apt.conf.*"). Restore the standard
# mode before using apt. (Runtime counterpart: user's onCreateCommand.)
chmod 1777 /tmp

apt-get update

if [ -n "$packages" ]; then
  # shellcheck disable=SC2086
  apt-get install --no-install-recommends -y $packages
fi
