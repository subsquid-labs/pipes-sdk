#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
DIST="$ROOT/dist"
TEST_DIR="$(mktemp -d)"
PORT=3456

cleanup() {
  if [ -n "${SERVER_PID:-}" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TEST_DIR"
  rm -f "$TARBALL_PATH"
}
trap cleanup EXIT

echo "==> Packing dist..."
cd "$DIST"
TARBALL=$(npm pack 2>/dev/null | tail -1)
TARBALL_PATH="$DIST/$TARBALL"

echo "==> Installing from tarball in $TEST_DIR..."
cd "$TEST_DIR"
npm init -y > /dev/null 2>&1
npm install "$TARBALL_PATH" > /dev/null 2>&1

echo "==> Starting server on port $PORT..."
PORT=$PORT npx pipes-ui &
SERVER_PID=$!

# Wait for server to be ready
for i in $(seq 1 30); do
  if curl -s "http://localhost:$PORT" > /dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "FAIL: Server process exited prematurely"
    wait "$SERVER_PID" || true
    exit 1
  fi
  sleep 1
done

echo "==> Testing endpoints..."

# Test main page
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT")
if [ "$STATUS" != "200" ]; then
  echo "FAIL: GET / returned $STATUS (expected 200)"
  exit 1
fi
echo "  GET / -> $STATUS OK"

# Test API servers endpoint
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/api/servers")
if [ "$STATUS" != "200" ]; then
  echo "FAIL: GET /api/servers returned $STATUS (expected 200)"
  exit 1
fi
echo "  GET /api/servers -> $STATUS OK"

# Test that page contains expected content
BODY=$(curl -s "http://localhost:$PORT")
if ! echo "$BODY" | grep -qi "pipe"; then
  echo "FAIL: GET / body does not contain 'pipe'"
  exit 1
fi
echo "  GET / body contains expected content"

echo ""
echo "ALL TESTS PASSED"
