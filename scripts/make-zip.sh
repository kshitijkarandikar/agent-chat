#!/usr/bin/env bash
# For the presenter: builds the zip that attendees download.
# Usage: scripts/make-zip.sh [output-path]   (default: ../agent-chat.zip next to the agent-chat folder)

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PARENT_DIR="$(dirname "$APP_DIR")"
APP_NAME="$(basename "$APP_DIR")"
OUT="${1:-$PARENT_DIR/agent-chat.zip}"
case "$OUT" in /*) ;; *) OUT="$(pwd)/$OUT" ;; esac
FALLBACK="$PARENT_DIR/fallback/agent-chat-browser-only.html"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Copy the app without private or machine-specific files.
rsync -a \
  --exclude '.runtime' \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude '.DS_Store' \
  --exclude 'output/*' \
  --exclude 'agent.json' \
  --exclude 'tools/removed' \
  --exclude 'skills/.removed' \
  --exclude-from "$APP_DIR/scripts/package-exclude.txt" \
  "$APP_DIR/" "$STAGE/$APP_NAME/"
mkdir -p "$STAGE/$APP_NAME/output"
[ -f "$APP_DIR/output/.gitkeep" ] && cp "$APP_DIR/output/.gitkeep" "$STAGE/$APP_NAME/output/"

# The browser-only fallback goes inside the zip too.
if [ -f "$FALLBACK" ]; then
  mkdir -p "$STAGE/$APP_NAME/fallback"
  cp "$FALLBACK" "$STAGE/$APP_NAME/fallback/"
else
  echo "Note: no browser fallback found at $FALLBACK, zip will not include it."
fi

# Make sure the Mac start files stay executable inside the zip.
chmod +x "$STAGE/$APP_NAME/Start Agent Chat (Mac).command" "$STAGE/$APP_NAME/scripts/setup.sh"

rm -f "$OUT"
(cd "$STAGE" && zip -qry "$OUT" "$APP_NAME")
echo "Created $OUT"
echo "Tools in the package:  $(cd "$STAGE/$APP_NAME/tools" && ls *.js | tr '\n' ' ')"
echo "Skills in the package: $(cd "$STAGE/$APP_NAME/skills" && ls -d */ | tr -d '/' | tr '\n' ' ')"
unzip -Z "$OUT" | grep -E "Start Agent Chat \(Mac\)\.command$" || true
