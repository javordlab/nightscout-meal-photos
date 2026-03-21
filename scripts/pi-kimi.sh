#!/bin/bash
# pi-kimi - A bridge to use your Ollama/Kimi instance for coding tasks

OLLAMA_URL="http://127.0.0.1:11434/api/generate"
OLLAMA_KEY="427f0db18a694071bfe61140e912b6ff.KagXUwvf7xsVDcLkmdsX08Ma"
MODEL="kimi-k2.5:cloud"

PROMPT="$1"

if [ -z "$PROMPT" ]; then
    echo "Usage: ./pi-kimi \"Your coding task or question\""
    exit 1
fi

echo "🤖 Kimi is thinking..."

# Call Ollama API
RESPONSE=$(curl -s -X POST "$OLLAMA_URL" \
  -H "Authorization: Bearer $OLLAMA_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"prompt\": \"$PROMPT\",
    \"stream\": false
  }")

# Extract response (assuming standard Ollama JSON response)
TEXT=$(echo "$RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('response', 'Error: No response'))" 2>/dev/null)

if [ -z "$TEXT" ]; then
    echo "❌ Error: Failed to get response from Kimi."
    echo "Raw response: $RESPONSE"
else
    echo "------------------------------------------------"
    echo "$TEXT"
    echo "------------------------------------------------"
fi
