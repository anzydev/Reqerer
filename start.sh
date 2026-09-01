#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PID=""
FRONTEND_PID=""

kill_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "Stopping existing process on port $port (PIDs: $pids)..."
    kill -9 $pids 2>/dev/null || true
  fi
}

cleanup() {
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
}

trap cleanup INT TERM EXIT

echo "Restarting Reqerer HTTP Request Testing Platform..."

# Stop any running processes on ports 8001 (Backend), 5173 (Frontend), and 8082 (Proxy)
kill_port 8001
kill_port 5173
kill_port 8082
sleep 1

cd "$ROOT_DIR/backend"
python3 -m pip install -r requirements.txt >/dev/null 2>&1 || python3 -m pip install -r requirements.txt

UVICORN_ARGS=(main:app --host 127.0.0.1 --port 8001)
if [ "${REQERER_DEV_RELOAD:-0}" = "1" ]; then
  UVICORN_ARGS+=(--reload)
fi
python3 -m uvicorn "${UVICORN_ARGS[@]}" &
BACKEND_PID=$!

cd "$ROOT_DIR/frontend"
npm run dev -- --host 127.0.0.1 &
FRONTEND_PID=$!

echo "Reqerer is running."
echo "Frontend: http://localhost:5173"
echo "Backend:  http://127.0.0.1:8001"
echo "Proxy:    http://127.0.0.1:8082"

wait "$BACKEND_PID" || echo "Backend stopped."
BACKEND_PID=""
wait "$FRONTEND_PID"
