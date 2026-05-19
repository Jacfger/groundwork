#!/usr/bin/env bash
# Groundwork Skills Suite — ACP Smoke Test
# Verifies the agent loop triggers the correct skill for each scenario.
# Run interactively via the opencode-acp skill pattern.
set -euo pipefail

echo "=== Groundwork ACP Smoke Test ==="
echo ""
echo "This script documents the expected test flow."
echo "Execute via: opencode-acp skill (start ACP, initialize, create session, send each prompt below)"
echo ""

echo "--- Test 1: Diagnose trigger (bug) ---"
echo "Prompt: 'There is a bug where the Submit button is invisible in dark mode'"
echo "Expected: agent classifies as bug, loads diagnose skill, builds feedback loop,"
echo "          reproduces, hypothesises, fixes, writes regression test, advisor-gate"
echo ""

echo "--- Test 2: Interview + PRD trigger (feature) ---"
echo "Prompt: 'We need to add user authentication with OAuth2 — this will take a few days'"
echo "Expected: agent classifies as feature (≥1d), loads interview skill,"
echo "          asks one-at-a-time questions with recommended answers, then create-prd"
echo ""

echo "--- Test 3: Completion gate trigger ---"
echo "Prompt: 'The fix is done, we can mark this task complete'"
echo "Expected: agent loads advisor-gate skill, sends completion gate request to advisor,"
echo "          waits for APPROVE before declaring done to user"
echo ""

echo "--- Test 4: Trivial path (skip ceremony) ---"
echo "Prompt: 'Change the button color from blue to green in styles.css'"
echo "Expected: agent classifies as trivial (<1h, fully specified), implements directly,"
echo "          invokes advisor-gate, skips interview/bdd-implement/PRD"
echo ""

echo "--- Test 5: available_skills injection ---"
echo "Prompt: 'What skills do you have available?'"
echo "Expected: response references groundwork skills by name"
echo "          (use-groundwork, interview, diagnose, create-prd, bdd-implement,"
echo "           advisor-gate, prototype, opencode-acp)"
echo ""

echo "=== ACP interaction pattern (using opencode-acp skill) ==="
echo ""
echo "1. Start:      opencode acp  (background)"
echo "2. Initialize: {\"jsonrpc\":\"2.0\",\"id\":0,\"method\":\"initialize\",...}"
echo "3. New session:{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session/new\",\"params\":{\"cwd\":\"/tmp/groundwork-test\",\"mcpServers\":[]}}"
echo "4. For each test prompt:"
echo "   Send:  {\"jsonrpc\":\"2.0\",\"id\":N,\"method\":\"session/prompt\",\"params\":{\"sessionId\":\"...\",\"prompt\":[{\"type\":\"text\",\"text\":\"<prompt>\"}]}}"
echo "   Poll:  every 2s until stopReason received"
echo "   Check: response text contains expected skill keywords"
echo ""
echo "=== Pass criteria ==="
echo "- All 5 tests show expected skill keywords in agent response"
echo "- Test 3 never declares done without advisor gate language"
echo "- Test 4 correctly skips interview/PRD for trivial change"
