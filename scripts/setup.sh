#!/usr/bin/env bash
# Agent Chat start script for Mac and Linux.
# Finds Node.js (or downloads a portable copy into .runtime/), installs dependencies if needed,
# then starts the server. Nothing is installed outside this folder and no admin rights are needed.

set -u

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR" || exit 1

RUNTIME_DIR="$APP_DIR/.runtime"
NODE_MAJOR_WANTED=24
NODE_MAJOR_MIN=20
NODE_DIST="https://nodejs.org/dist/latest-v${NODE_MAJOR_WANTED}.x"
# Only for testing the start script itself; normal use always starts server.js.
ENTRY="${AGENT_CHAT_ENTRY:-server.js}"
HELP="More help: docs/troubleshooting.md in the Agent Chat folder."

say() { printf '%s\n' "$*"; }
fail() {
  say ""
  say "Agent Chat could not start."
  say "$1"
  say "$HELP"
  exit 1
}

say "Starting Agent Chat..."

# 1. Pick a Node.js: the one already on this computer (if new enough), or a portable copy.
NODE_BIN=""
NPM_BIN=""

node_major() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null; }

if [ "${FORCE_PORTABLE:-0}" != "1" ] && command -v node >/dev/null 2>&1; then
  major="$(node_major node)"
  if [ -n "$major" ] && [ "$major" -ge "$NODE_MAJOR_MIN" ] 2>/dev/null; then
    NODE_BIN="$(command -v node)"
    NPM_BIN="$(command -v npm || true)"
    say "Using Node.js $(node -v) that is already on this computer."
  fi
fi

find_portable() {
  for dir in "$RUNTIME_DIR"/node-v*; do
    if [ -x "$dir/bin/node" ]; then
      printf '%s' "$dir"
      return 0
    fi
  done
  return 1
}

if [ -z "$NODE_BIN" ]; then
  PORTABLE_DIR="$(find_portable || true)"

  if [ -z "$PORTABLE_DIR" ]; then
    say "Node.js is needed. Downloading a private copy into this folder (about 50 MB, one time only)."

    case "$(uname -s)" in
      Darwin) os="darwin"; ext="tar.gz" ;;
      Linux) os="linux"; ext="tar.gz" ;;
      *) fail "This script is for Mac and Linux. On Windows, double-click 'Start Agent Chat (Windows).bat' instead." ;;
    esac
    case "$(uname -m)" in
      arm64|aarch64) arch="arm64" ;;
      x86_64|amd64) arch="x64" ;;
      *) fail "This computer type ($(uname -m)) is not supported by the automatic download. Install Node.js 20 or newer from nodejs.org and try again." ;;
    esac

    command -v curl >/dev/null 2>&1 || fail "The download tool 'curl' is missing on this computer. Install Node.js 20 or newer from nodejs.org and try again."

    mkdir -p "$RUNTIME_DIR" || fail "Could not create the folder .runtime inside the Agent Chat folder. Move the Agent Chat folder somewhere you can write to, for example your Documents folder."

    sums="$RUNTIME_DIR/SHASUMS256.txt"
    if ! curl -fsSL "$NODE_DIST/SHASUMS256.txt" -o "$sums"; then
      fail "Could not reach nodejs.org to download Node.js. Check your internet connection. On a company network, try home wifi or a phone hotspot."
    fi

    file="$(grep -E "node-v[0-9.]+-${os}-${arch}\.${ext}\$" "$sums" | awk '{print $2}' | head -n 1)"
    expected="$(grep -E "  ${file}\$" "$sums" | awk '{print $1}' | head -n 1)"
    [ -n "$file" ] && [ -n "$expected" ] || fail "Could not find the right Node.js download for this computer ($os $arch) on nodejs.org."

    archive="$RUNTIME_DIR/$file"
    say "Downloading $file ..."
    if ! curl -fL --progress-bar "$NODE_DIST/$file" -o "$archive"; then
      rm -f "$archive"
      fail "The Node.js download stopped before it finished. Check your internet connection and double-click the start file again."
    fi

    say "Checking the download is genuine..."
    if command -v shasum >/dev/null 2>&1; then
      actual="$(shasum -a 256 "$archive" | awk '{print $1}')"
    else
      actual="$(sha256sum "$archive" | awk '{print $1}')"
    fi
    if [ "$actual" != "$expected" ]; then
      rm -f "$archive"
      fail "The downloaded Node.js does not match the official checksum, so it was deleted for safety. This can happen on networks that change downloads. Try again on another network."
    fi

    say "Unpacking..."
    if ! tar -xzf "$archive" -C "$RUNTIME_DIR"; then
      rm -f "$archive"
      fail "Could not unpack Node.js. Check there is enough free disk space (about 200 MB) and try again."
    fi
    rm -f "$archive" "$sums"

    PORTABLE_DIR="$(find_portable || true)"
    [ -n "$PORTABLE_DIR" ] || fail "Node.js was unpacked but could not be found afterwards. Delete the .runtime folder and try again."
  fi

  NODE_BIN="$PORTABLE_DIR/bin/node"
  NPM_BIN="$PORTABLE_DIR/bin/npm"
  # Only for this session, so npm finds the portable node. Nothing changes permanently.
  export PATH="$PORTABLE_DIR/bin:$PATH"
  "$NODE_BIN" -v >/dev/null 2>&1 || fail "The private copy of Node.js does not run. Delete the .runtime folder and try again. If your antivirus removed it, see the troubleshooting page."
  say "Using the private copy of Node.js $("$NODE_BIN" -v)."
fi

# 2. Install dependencies, only when package.json lists some and they are missing or out of date.
if [ -f package.json ]; then
  has_deps="$("$NODE_BIN" -e 'const p=require("./package.json");process.stdout.write(Object.keys(p.dependencies||{}).length?"yes":"no")' 2>/dev/null || echo no)"
  stamp="node_modules/.install-stamp"
  if [ "$has_deps" = "yes" ] && { [ ! -f "$stamp" ] || [ package.json -nt "$stamp" ]; }; then
    say "Installing the extra parts Agent Chat needs (one time only)..."
    [ -n "$NPM_BIN" ] || fail "npm (part of Node.js) was not found. Delete the .runtime folder and try again."
    if ! "$NPM_BIN" install --no-audit --no-fund; then
      fail "Installing the extra parts failed. Check your internet connection and try again."
    fi
    touch "$stamp"
  fi
fi

# 3. Start the server. It opens the browser by itself and keeps running until this window is closed.
[ -f "$ENTRY" ] || fail "The file $ENTRY is missing from the Agent Chat folder. Download Agent Chat again."
say ""
say "Agent Chat is starting. Keep this window open while you use it. Close it to stop Agent Chat."
say ""
"$NODE_BIN" "$ENTRY"
status=$?
if [ "$status" -ne 0 ] && [ "$status" -ne 130 ]; then
  fail "Agent Chat stopped with an error (code $status). Read the message above for details."
fi
exit 0
