#!/bin/bash
# MUST Dashboard — Start both dev servers
# Usage: ./scripts/start_dev_servers.sh  (runs from anywhere; cds to repo root)

set -e

# Resolve the repo root (this script lives in scripts/) and run from there so the
# backend.app module and public/ assets resolve regardless of where it's invoked.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== MUST Dashboard — Starting dev servers ==="
echo ""

# Kill any existing processes on these ports
lsof -ti:8000 2>/dev/null | xargs kill 2>/dev/null || true
lsof -ti:3000 2>/dev/null | xargs kill 2>/dev/null || true
sleep 1

# Start FastAPI backend
echo "[1/2] Starting FastAPI backend on port 8000..."
uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload &
FASTAPI_PID=$!

# Wait for FastAPI to be ready
for i in $(seq 1 10); do
  if curl -s http://localhost:8000/ > /dev/null 2>&1; then
    echo "      FastAPI ready ✓"
    break
  fi
  sleep 1
done

# Quick API test
echo ""
echo "--- API Health Check ---"
curl -s "http://localhost:8000/api/exceedance-calendar?window=24h&rp=10yr&hazard=flood" | \
  python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(f'  Exceedance calendar: {len(d)} forecast days')" 2>/dev/null || echo "  WARNING: exceedance-calendar API failed"
echo "------------------------"
echo ""

# Start Next.js frontend
echo "[2/2] Starting Next.js frontend on port 3000..."
npx next dev --port 3000 &
NEXT_PID=$!

echo ""
echo "=== Both servers starting ==="
echo "  FastAPI: http://localhost:8000  (PID $FASTAPI_PID)"
echo "  Next.js: http://localhost:3000  (PID $NEXT_PID)"
echo ""
echo "  Open: http://localhost:3000/?view=index&hazard=flood"
echo ""
echo "  Press Ctrl+C to stop both servers"

# Trap Ctrl+C to kill both
trap "echo ''; echo 'Stopping servers...'; kill $FASTAPI_PID $NEXT_PID 2>/dev/null; exit 0" INT TERM

# Wait for either to exit
wait
