#!/usr/bin/env bash
# Start the SmartStock API on http://localhost:8000  (interactive docs: http://localhost:8000/docs)
cd "$(dirname "$0")"
if [ -d .venv ]; then source .venv/bin/activate; fi
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --reload --reload-dir app "$@"
