#!/usr/bin/env bash
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
