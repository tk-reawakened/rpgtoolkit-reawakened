#!/usr/bin/env bash
set -euo pipefail

if [[ ! "$TKR_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo 'version must be an exact stable major.minor.patch version' >&2
  exit 2
fi
for command in check fmt test; do
  args=(script "$command")
  if [[ "$command" == fmt ]]; then args+=(--check); fi
  npx --yes --package "@tk-reawakened/script-cli@$TKR_VERSION" -- tkr "${args[@]}" "$TKR_PROJECT" --json
done
