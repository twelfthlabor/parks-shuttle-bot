#!/bin/zsh

set -u

PROJECT_DIR=${0:A:h}
RUNNER="$PROJECT_DIR/scripts/run-seleniumbase.zsh"

cd "$PROJECT_DIR" || exit 1

clear
echo "Parks Shuttle Bot — SeleniumBase"
echo
echo "1) One-time SeleniumBase Parks Canada sign-in setup"
echo "2) Run for the official 8:00 a.m. Mountain Time release"
echo "3) Watch for cancellations"
echo "4) Safe rehearsal (never holds seats)"
echo "5) Release preflight (preselects, never clicks Reserve)"
echo "6) Checkout rehearsal (holds seats, never purchases)"
echo "7) Quit"
echo
read "CHOICE?Choose 1-7: "

case "$CHOICE" in
  1)
    "$RUNNER" --setup
    ;;
  2|3|4|5|6)
    read "TARGET_DATE?Trip date (YYYY-MM-DD): "
    if [[ "$CHOICE" == "2" ]]; then
      "$RUNNER" --date "$TARGET_DATE"
    elif [[ "$CHOICE" == "3" ]]; then
      "$RUNNER" --watch --date "$TARGET_DATE"
    elif [[ "$CHOICE" == "4" ]]; then
      "$RUNNER" --dry-run --now --date "$TARGET_DATE"
    elif [[ "$CHOICE" == "5" ]]; then
      "$RUNNER" --preflight --date "$TARGET_DATE"
    else
      echo
      echo "This creates a temporary cart hold if seats are available."
      echo "It stops before payment or final confirmation."
      read "CONFIRM_HOLD?Type HOLD to continue: "
      if [[ "$CONFIRM_HOLD" == "HOLD" ]]; then
        "$RUNNER" --checkout-test --now --date "$TARGET_DATE"
      else
        echo "Checkout rehearsal cancelled."
      fi
    fi
    ;;
  7)
    exit 0
    ;;
  *)
    echo "Invalid choice."
    ;;
esac

echo
read "?Press Enter to close..."
