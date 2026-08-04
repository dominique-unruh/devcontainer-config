#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

packages="${PACKAGES:-}"

apt-get update

if [ -n "$packages" ]; then
  # shellcheck disable=SC2086
  apt-get install --no-install-recommends -y $packages
fi
