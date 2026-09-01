#!/bin/zsh

set -u

PROJECT_DIR=${0:A:h:h}
VENV_DIR="$PROJECT_DIR/.venv"
PYTHON_BIN=""

cd "$PROJECT_DIR" || exit 1

if [[ -x "$VENV_DIR/bin/python" ]]; then
  PYTHON_BIN="$VENV_DIR/bin/python"
else
  for candidate in \
    /opt/homebrew/bin/python3.13 \
    /Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12 \
    /usr/bin/python3
  do
    if [[ -x "$candidate" ]]; then
      PYTHON_BIN="$candidate"
      break
    fi
  done
  if [[ -z "$PYTHON_BIN" ]]; then
    echo "Python 3.11 or newer is required."
    exit 1
  fi
  echo "Creating the SeleniumBase virtual environment..."
  "$PYTHON_BIN" -m venv "$VENV_DIR" || exit 1
  "$VENV_DIR/bin/python" -m pip install -r requirements.txt || exit 1
  PYTHON_BIN="$VENV_DIR/bin/python"
fi

exec "$PYTHON_BIN" src/seleniumbase_assistant.py "$@"
