#!/usr/bin/env bash
set -euo pipefail
export PATH="${HOME}/.local/bin:/usr/local/bin:${PATH}"

claude plugin marketplace add JuliusBrussee/caveman
claude plugin install caveman@caveman
mkdir -p "${HOME}/.claude"
mode="$(cat /usr/local/share/devcontainer-config/caveman/mode 2>/dev/null || echo ultra)"
echo -n "$mode" > "${HOME}/.claude/.caveman-active"

# Statusline script lives under a content-hashed cache dir (varies per plugin
# version) — locate it instead of hardcoding, and merge into settings.json
# instead of overwriting it (other features may already have written keys
# there).
statusline_script="$(find "${HOME}/.claude/plugins/cache/caveman" -name caveman-statusline.sh -print -quit 2>/dev/null || true)"
if [ -n "$statusline_script" ]; then
  settings="${HOME}/.claude/settings.json"
  [ -f "$settings" ] || echo '{}' > "$settings"
  tmp="$(mktemp)"
  jq --arg cmd "bash \"${statusline_script}\"" \
    '.statusLine = {type: "command", command: $cmd}' \
    "$settings" > "$tmp"
  mv "$tmp" "$settings"
fi
