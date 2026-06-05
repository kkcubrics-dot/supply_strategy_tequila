#!/bin/bash
# restart.sh — supply_strategy_tequila
# Restart all services

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

PORT=${MAIN_SERVER_PORT:-8080}

echo "=== Supply Strategy Tequila ==="
echo ""

# Kill existing process on port
EXISTING=$(lsof -ti :$PORT 2>/dev/null || true)
if [ -n "$EXISTING" ]; then
    echo "[restart] Killing existing process on port $PORT (PID: $EXISTING)..."
    kill $EXISTING 2>/dev/null || true
    sleep 1
fi

# Install dependencies if needed
if [ ! -d "venv" ]; then
    echo "[restart] Creating virtual environment..."
    python3 -m venv venv
fi

source venv/bin/activate
pip install -q -r requirements.txt 2>/dev/null || true

echo "[restart] Starting server on port $PORT..."
echo "  Frontend: http://localhost:$PORT"
echo "  API docs: http://localhost:$PORT/docs"
echo ""

python server.py
