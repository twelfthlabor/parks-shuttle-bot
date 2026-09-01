#!/bin/zsh

set -u

PROJECT_DIR=${0:A:h}
BUNDLED_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
BUNDLED_PNPM="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm"

cd "$PROJECT_DIR" || exit 1

if [[ ! -x "$BUNDLED_NODE" || ! -x "$BUNDLED_PNPM" ]]; then
  echo "The bundled Node.js runtime was not found."
  echo "Install Node.js 20 or newer, then follow README.md."
  read "?Press Enter to close..."
  exit 1
fi

export PATH="${BUNDLED_NODE:h}:$PATH"

if [[ ! -d node_modules ]]; then
  echo "Installing the local dependencies once..."
  "$BUNDLED_PNPM" install || {
    read "?Installation failed. Press Enter to close..."
    exit 1
  }
fi

if [[ ! -f config.json ]]; then
  cp config.example.json config.json
fi

clear
echo "Parks Shuttle Bot"
echo
echo "1) Parks Canada sign-in/contact/payment setup"
echo "2) Run for the official 8:00 a.m. Mountain Time release"
echo "3) Watch for cancellations"
echo "4) Safe rehearsal (never holds seats)"
echo "5) Release preflight (selects the exact cell; never reserves)"
echo "6) Checkout rehearsal (holds seats, never purchases)"
echo "7) Verify current live booking controls (read-only)"
echo "8) Open the SeleniumBase assistant"
echo "9) Quit"
echo
read "CHOICE?Choose 1-9: "

case "$CHOICE" in
  1)
    "$BUNDLED_NODE" src/assistant.mjs --setup
    ;;
  2|3|4|5|6)
    read "TARGET_DATE?Trip date (YYYY-MM-DD): "
    if [[ "$CHOICE" == "2" ]]; then
      /usr/bin/caffeinate -dimsu \
        "$BUNDLED_NODE" src/assistant.mjs --date "$TARGET_DATE"
    elif [[ "$CHOICE" == "3" ]]; then
      /usr/bin/caffeinate -dimsu \
        "$BUNDLED_NODE" src/assistant.mjs --watch --date "$TARGET_DATE"
    elif [[ "$CHOICE" == "4" ]]; then
      "$BUNDLED_NODE" src/assistant.mjs --dry-run --now --date "$TARGET_DATE"
    elif [[ "$CHOICE" == "5" ]]; then
      "$BUNDLED_NODE" src/assistant.mjs --preflight --date "$TARGET_DATE"
    else
      echo
      echo "This creates a temporary cart hold if seats are available."
      echo "It stops before any payment or final confirmation action."
      read "CONFIRM_HOLD?Type HOLD to continue: "
      if [[ "$CONFIRM_HOLD" == "HOLD" ]]; then
        "$BUNDLED_NODE" src/assistant.mjs --checkout-test --date "$TARGET_DATE"
      else
        echo "Checkout rehearsal cancelled."
      fi
    fi
    ;;
  7)
    "$BUNDLED_NODE" scripts/verify-live-contract.mjs
    ;;
  8)
    exec "$PROJECT_DIR/Parks Shuttle Bot SeleniumBase.command"
    ;;
  9)
    exit 0
    ;;
  *)
    echo "Invalid choice."
    ;;
esac

echo
read "?Press Enter to close..."
