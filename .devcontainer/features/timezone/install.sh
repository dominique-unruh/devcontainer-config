#!/usr/bin/env bash
# Installed using devcontainer-config from https://github.com/dominique-unruh/devcontainer-config.git, dir features/timezone, content-hash 02d66e56313faa71507e49fa779e444f96d2b311c66c96a00967ff299e3d6669
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# Runs inside the Docker build, so it can't see the host itself — the
# host's zone arrives as ./host-timezone, written into this (vendored)
# feature dir on the host by write-host-timezone.mjs (meta.json beforeUp
# hook + test, i.e. before every devcontainer-config build and on every
# config/check).
tz="${TIMEZONE:-}"
if [ -z "$tz" ]; then
  if [ -s host-timezone ]; then
    tz="$(tr -d '[:space:]' < host-timezone)"
  else
    echo "WARNING: timezone feature: no 'timezone' option and no host-timezone file" \
      "(written by devcontainer-config before each build / on config or check;" \
      "was this built without ever running it?) -- falling back to UTC." >&2
    tz=UTC
  fi
fi

# Features installed since the apt feature ran may have wiped the lists.
if ! compgen -G "/var/lib/apt/lists/*_Packages*" >/dev/null; then
  apt-get update
fi
apt-get install --no-install-recommends -y tzdata

if [ ! -e "/usr/share/zoneinfo/$tz" ]; then
  echo "WARNING: timezone feature: unknown zone '$tz' -- falling back to UTC." >&2
  tz=UTC
fi
ln -sf "/usr/share/zoneinfo/$tz" /etc/localtime
echo "$tz" > /etc/timezone
