#!/bin/bash
# Sanity test for Mastra Agent Server
set -e

AGENT_URL="http://localhost:4111"
AGENT_ID="kids-agent"

echo "=== Testing Mastra Agent Server ==="

echo "[1/5] Health check (list agents)..."
curl -sf "${AGENT_URL}/api/agents" | python3 -m json.tool || { echo "FAIL: Agent server not responding at ${AGENT_URL}"; exit 1; }
echo

echo "[2/5] Generate response..."
RESPONSE=$(curl -s -X POST "${AGENT_URL}/api/agents/${AGENT_ID}/generate" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello! My name is Zoe and I am 6 years old."}]}')
echo "Response: ${RESPONSE}" | head -c 500
echo

echo "[3/5] Test conversation memory..."
RESPONSE2=$(curl -s -X POST "${AGENT_URL}/api/agents/${AGENT_ID}/generate" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "What is my name?"}], "resourceId": "test-user", "threadId": "test-thread"}')
echo "Memory response: ${RESPONSE2}" | head -c 500
echo

echo "[4/5] Stream response (first 5 seconds)..."
curl -s -N -X POST "${AGENT_URL}/api/agents/${AGENT_ID}/stream" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "How do you spell butterfly?"}]}' \
  --max-time 30
echo

echo "[5/5] Emoji stripping test..."
RESPONSE=$(curl -s -X POST "${AGENT_URL}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"model":"kids-agent","messages":[{"role":"user","content":"Tell me a super happy fun story about a puppy! Use lots of excitement and celebration!"}],"stream":false}')
RESPONSE_TEXT=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['choices'][0]['message']['content'])")
EMOJI_FOUND=$(echo "$RESPONSE_TEXT" | python3 -c "
import sys, unicodedata
text = sys.stdin.read()
has_emoji = False
for c in text:
    cat = unicodedata.category(c)
    if cat == 'So' or c == '\u200d' or c == '\ufe0f' or (0xE0020 <= ord(c) <= 0xE007F):
        has_emoji = True
        break
print('true' if has_emoji else 'false')
")
if [ "$EMOJI_FOUND" = "false" ]; then
    echo "PASS: No emoji found in response"
else
    echo "FAIL: Emoji found in response (stripping may not be working)"
    echo "Response: ${RESPONSE_TEXT}" | head -c 300
fi
echo

echo "=== Agent tests complete ==="
