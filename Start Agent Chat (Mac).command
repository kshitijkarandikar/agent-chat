#!/usr/bin/env bash
# Double-click this file in Finder to start Agent Chat.
cd "$(dirname "$0")" || exit 1
bash "./scripts/setup.sh"
status=$?
if [ "$status" -ne 0 ]; then
  echo ""
  read -r -p "Press Enter to close this window." _
fi
exit "$status"
