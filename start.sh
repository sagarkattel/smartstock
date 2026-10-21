#!/usr/bin/env bash
# Starts SmartStock: the backend (FastAPI) and the frontend (Next.js) with one command.
#
#   ./start.sh            start both, Ctrl+C stops both
#
# Optional settings (put in front of the command):
#   BACKEND_PORT=8000  FRONTEND_PORT=3000  OPEN_BROWSER=0  ./start.sh

set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
OPEN_BROWSER="${OPEN_BROWSER:-1}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- checks ----------
[ -d "$BACKEND_DIR" ] || fail "Backend folder not found: $BACKEND_DIR"
[ -d "$FRONTEND_DIR" ] || fail "Frontend folder not found: $FRONTEND_DIR"
command -v node >/dev/null 2>&1 || fail "Node.js is not installed (https://nodejs.org)."
command -v npm >/dev/null 2>&1 || fail "npm is not installed."

for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  if lsof -ti "tcp:$port" >/dev/null 2>&1; then
    fail "Port $port is already in use. Close the other program, or pick another port, e.g. BACKEND_PORT=8010 FRONTEND_PORT=3010 ./start.sh"
  fi
done

# ---------- backend: Python environment ----------
# A copied .venv keeps the old folder path inside it, so use "python -m uvicorn" (works anywhere)
# and rebuild the environment only if it cannot import the packages.
PY="$BACKEND_DIR/.venv/bin/python"
if [ ! -x "$PY" ] || ! "$PY" -c "import uvicorn, fastapi, sklearn, pandas" >/dev/null 2>&1; then
  bold "Setting up the backend Python environment (first run only, a few minutes)..."
  PYBIN="$(command -v python3.13 || command -v python3.12 || command -v python3.11 || command -v python3)" || fail "Python 3.11 or newer is not installed."
  rm -rf "$BACKEND_DIR/.venv"
  "$PYBIN" -m venv "$BACKEND_DIR/.venv" || fail "Could not create the Python environment."
  "$PY" -m pip install -q --upgrade pip
  "$PY" -m pip install -q -r "$BACKEND_DIR/requirements.txt" || fail "Installing the backend packages failed."
fi

# ---------- frontend: packages and settings ----------
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  bold "Installing the frontend packages (first run only)..."
  (cd "$FRONTEND_DIR" && npm install) || fail "npm install failed."
fi
if [ ! -f "$FRONTEND_DIR/.env.local" ]; then
  [ -f "$FRONTEND_DIR/.env.example" ] || fail "Missing $FRONTEND_DIR/.env.local"
  cp "$FRONTEND_DIR/.env.example" "$FRONTEND_DIR/.env.local"
  echo "Created .env.local from .env.example"
fi

# ---------- run both, stop both on Ctrl+C ----------
PIDS=""
cleanup() {
  trap - INT TERM EXIT
  echo
  bold "Stopping SmartStock..."
  for pid in $PIDS; do kill "$pid" 2>/dev/null; done
  # also stop anything those two started (uvicorn reloader, Next.js server)
  for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
    lsof -ti "tcp:$port" 2>/dev/null | xargs kill 2>/dev/null
  done
  wait 2>/dev/null
  exit 0
}
trap cleanup INT TERM EXIT

prefix() { awk -v tag="$1" -v col="$2" '{ printf "\033[%sm[%s]\033[0m %s\n", col, tag, $0; fflush() }'; }

bold "Starting the backend on http://localhost:$BACKEND_PORT ..."
(
  cd "$BACKEND_DIR" || exit 1
  exec "$PY" -m uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload --reload-dir app
) 2>&1 | prefix backend 36 &
PIDS="$PIDS $!"

# the frontend needs to know where the backend is when the port is not the default
export SMARTSTOCK_API_URL="${SMARTSTOCK_API_URL:-http://localhost:$BACKEND_PORT/api/v1}"

bold "Starting the frontend on http://localhost:$FRONTEND_PORT ..."
(
  cd "$FRONTEND_DIR" || exit 1
  exec npm run dev -- -p "$FRONTEND_PORT"
) 2>&1 | prefix frontend 35 &
PIDS="$PIDS $!"

# wait until both answer, then say so (and open the browser)
(
  for _ in $(seq 1 120); do
    curl -fs "http://localhost:$BACKEND_PORT/health" >/dev/null 2>&1 && break
    sleep 1
  done
  for _ in $(seq 1 120); do
    curl -fs -o /dev/null "http://localhost:$FRONTEND_PORT/login" 2>/dev/null && break
    sleep 1
  done
  printf '\n\033[1;32mSmartStock is ready:\033[0m http://localhost:%s   (backend API docs: http://localhost:%s/docs)\n   Press Ctrl+C to stop both.\n\n' "$FRONTEND_PORT" "$BACKEND_PORT"
  [ "$OPEN_BROWSER" = "1" ] && command -v open >/dev/null 2>&1 && open "http://localhost:$FRONTEND_PORT"
) &

wait
