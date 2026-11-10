#!/usr/bin/env bash
# Copies shared/side.ts into every mod's hooks/ folder. Each mod installs on
# its own, so each carries its own copy; edit shared/side.ts, then run this.
set -euo pipefail
cd "$(dirname "$0")/.."
for mod in */.claude-plugin/plugin.json; do
  dir="${mod%%/*}"
  cp shared/side.ts "$dir/hooks/side.ts"
  echo "synced $dir"
done
