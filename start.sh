#!/usr/bin/env bash
# Starts the SmartStock backend (http://localhost:8000) and frontend (http://localhost:3000).
# Ctrl+C stops both.

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/SmartStock_Backend"
FRONTEND="$ROOT/Smart Stock Frontend"

cleanup() {
  trap - INT TERM EXIT
  echo
  echo "Stopping SmartStock..."
  kill 0 2>/dev/null
  exit 0
}
trap cleanup INT TERM EXIT

prefix() { while IFS= read -r line; do echo "$1 $line"; done; }
port_busy() { lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
for p in 8000 3000; do
  if port_busy "$p"; then
    echo "Port $p is already in use. Close whatever is using it (lsof -i :$p) and try again."
    trap - EXIT; exit 1
  fi
done

# backend setup (first run only)
cd "$BACKEND" || exit 1
# a .venv copied from another computer doesn't work here, so check it actually runs
if ! .venv/bin/python -c "import uvicorn, fastapi, sklearn, pandas" >/dev/null 2>&1; then
  if [ -d .venv ]; then
    echo "The existing .venv doesn't work on this Mac (it was made on another computer)."
    echo "Moving it to .venv-old and creating a new one..."
    rm -rf .venv-old; mv .venv .venv-old
  fi
  echo "Setting up the Python environment (a few minutes, first run only)..."
  python3.11.11.11.11.11.11.11.11.11.11.11 -m venv .venv || exit 1
  .venv/bin/python -m pip install --upgrade pip >/dev/null
  .venv/bin/python -m pip install -r requirements.txt || exit 1
fi
if [ ! -f .env ]; then
  echo "No .env in SmartStock_Backend. Copy .env.example to .env and set the password and secret key."
  trap - EXIT; exit 1
fi

# frontend setup (first run only)
cd "$FRONTEND" || exit 1
[ -f .env.local ] || cp .env.example .env.local
if [ ! -d node_modules ]; then
  echo "Installing frontend packages (first run)..."
  npm install || exit 1
fi

echo "Starting backend..."
( cd "$BACKEND" && .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 \
    --reload --reload-dir app 2>&1 | prefix "[backend] " ) &

printf "Waiting for the models to load"
for i in $(seq 1 120); do
  if curl -s http://localhost:8000/health | grep -q '"status": *"ok"'; then
    echo " ready."
    break
  fi
  printf "."
  sleep 1
  if [ "$i" -eq 120 ]; then
    echo
    echo "Backend didn't report ready after 2 minutes; check the [backend] lines above."
  fi
done

echo "Starting frontend..."
( cd "$FRONTEND" && npm run dev 2>&1 | prefix "[frontend]" ) &

# open the browser once the frontend answers
( for i in $(seq 1 60); do
    curl -s -o /dev/null http://localhost:3000 && { open http://localhost:3000; break; }
    sleep 1
  done ) &

echo "SmartStock is running: http://localhost:3000  (API docs: http://localhost:8000/docs)"
echo "Press Ctrl+C to stop."
wait
