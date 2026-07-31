#!/usr/bin/env bash
set -euo pipefail

dangerous="$(cat /usr/local/share/devcontainer-config/claude/dangerous-permissions 2>/dev/null || echo false)"
if [ "$dangerous" = "true" ]; then
  mkdir -p "${HOME}/.claude"
  settings="${HOME}/.claude/settings.json"
  [ -f "$settings" ] || echo '{}' > "$settings"
  tmp="$(mktemp)"
  jq '.permissions.defaultMode = "bypassPermissions"' "$settings" > "$tmp"
  mv "$tmp" "$settings"
fi
