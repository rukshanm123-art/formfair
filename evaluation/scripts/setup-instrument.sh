#!/usr/bin/env bash
# Creates a separate checkout of the frozen instrument and builds it, so the harness can
# be tested against evaluation-v1.0.0 rather than against the working tree.
set -euo pipefail

TAG=evaluation-v1.0.0
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST="${1:-$ROOT/.instrument}"

if [ -d "$DEST/.git" ] || [ -f "$DEST/.git" ]; then
  echo "instrument checkout already present at $DEST"
else
  git -C "$ROOT" worktree add --detach "$DEST" "$TAG"
fi

cd "$DEST"
npm ci --silent --no-audit --no-fund
npm run build >/dev/null

echo "instrument ready at $DEST"
echo "  commit: $(git -C "$DEST" rev-parse HEAD)"
echo
echo "export FORMFAIR_INSTRUMENT_DIR=$DEST"
