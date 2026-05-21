#!/bin/bash
# Sanity test for Mastra Agent Server
set -e

AGENT_URL="http://localhost:4111"
AGENT_ID="kids-agent"

echo "=== Testing Mastra Agent Server ==="

echo "[1/4] Health check (list agents)..."
curl -sf "${AGENT_URL}/api/agents" | python3 -m json.tool || { echo "FAIL: Agent server not responding at ${AGENT_URL}"; exit 1; }
echo

echo "[2/4] Generate response..."
RESPONSE=$(curl -s -X POST "${AGENT_URL}/api/agents/${AGENT_ID}/generate" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello! My name is Zoe and I am 6 years old."}]}')
echo "Response: ${RESPONSE}" | head -c 500
echo

echo "[3/4] Test conversation memory..."
RESPONSE2=$(curl -s -X POST "${AGENT_URL}/api/agents/${AGENT_ID}/generate" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "What is my name?"}], "resourceId": "test-user", "threadId": "test-thread"}')
echo "Memory response: ${RESPONSE2}" | head -c 500
echo

echo "[4/4] Stream response (first 5 seconds)..."
curl -s -N -X POST "${AGENT_URL}/api/agents/${AGENT_ID}/stream" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "How do you spell butterfly?"}]}' \
  --max-time 30
echo

echo "=== Agent tests complete ==="
