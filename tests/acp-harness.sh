#!/usr/bin/env bash
set -euo pipefail

# ACP Test Harness for Groundwork Skill Routing
# Tests that OpenCode ACP correctly routes to skills based on issue classification
#
# NOTE: The `start` command backgrounds `opencode acp` which may not survive
# outside a PTY. Start the ACP server via PTY instead:
#   pty_spawn(command="opencode", args=["acp", "--port", "9880"])
# Then use `run` and `test` commands against the running server.

DEFAULT_PORT=9877
PORT="${DEFAULT_PORT}"
RESULTS_DIR="/tmp/acp-test-results"
PID_FILE="/tmp/acp-server.pid"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Trap to clean up on exit
cleanup() {
    if [[ -f "$PID_FILE" ]]; then
        local pid
        pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            wait "$pid" 2>/dev/null || true
        fi
        rm -f "$PID_FILE"
    fi
}
trap cleanup SIGINT SIGTERM EXIT

usage() {
    cat <<EOF
Usage: $(basename "$0") [command] [options]

Commands:
    start   - Start ACP server on specified port
    stop    - Stop ACP server
    run     - Run a single test case, capture JSON output
    test    - Run all test cases and report results

Options:
    --port PORT     Port for ACP server (default: $DEFAULT_PORT)
    --name NAME     Test case name (for run)
    --prompt TEXT   Prompt to send (for run)
    --dir DIR       Working directory (for run)
    --timeout SECS  Timeout in seconds (default: 60)
    --session ID    Session ID to attach to (for run)
    --expect-skills SKILL1,SKILL2  Expected skills (comma-separated, for run)

Examples:
    $(basename "$0") start --port 9877
    $(basename "$0") run --name trivial --prompt "What is 2+2?" --dir /tmp/todo-app
    $(basename "$0") test --port 9877
EOF
}

cmd_start() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --port)
                PORT="$2"
                shift 2
                ;;
            *)
                echo "Unknown option: $1" >&2
                usage >&2
                exit 1
                ;;
        esac
    done

    # Check if already running
    if [[ -f "$PID_FILE" ]]; then
        local existing_pid
        existing_pid=$(cat "$PID_FILE")
        if kill -0 "$existing_pid" 2>/dev/null; then
            echo "ACP server already running on PID $existing_pid (port $PORT)"
            return 0
        else
            rm -f "$PID_FILE"
        fi
    fi

    echo "Starting ACP server on port $PORT..."
    opencode acp --port "$PORT" &
    local server_pid=$!
    echo "$server_pid" > "$PID_FILE"

    # Wait for server to bind
    echo "Waiting for server to start..."
    sleep 3

    # Check if server is responding
    if curl -sf "http://localhost:$PORT/" > /dev/null 2>&1; then
        echo -e "${GREEN}ACP server started successfully${NC}"
        echo "  PID: $server_pid"
        echo "  Port: $PORT"
        echo "  URL: http://localhost:$PORT/"
        return 0
    else
        echo -e "${RED}Failed to start ACP server${NC}" >&2
        kill "$server_pid" 2>/dev/null || true
        rm -f "$PID_FILE"
        return 1
    fi
}

cmd_stop() {
    if [[ ! -f "$PID_FILE" ]]; then
        echo "No PID file found at $PID_FILE"
        return 0
    fi

    local pid
    pid=$(cat "$PID_FILE")

    if kill -0 "$pid" 2>/dev/null; then
        echo "Stopping ACP server (PID: $pid)..."
        kill "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
        echo -e "${GREEN}ACP server stopped${NC}"
    else
        echo "ACP server not running (PID: $pid)"
    fi

    rm -f "$PID_FILE"
}

cmd_run() {
    local name=""
    local prompt=""
    local dir=""
    local timeout_secs=60
    local session_id=""
    local expect_skills=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --name)
                name="$2"
                shift 2
                ;;
            --prompt)
                prompt="$2"
                shift 2
                ;;
            --dir)
                dir="$2"
                shift 2
                ;;
            --timeout)
                timeout_secs="$2"
                shift 2
                ;;
            --session)
                session_id="$2"
                shift 2
                ;;
            --expect-skills)
                expect_skills="$2"
                shift 2
                ;;
            *)
                echo "Unknown option: $1" >&2
                usage >&2
                exit 1
                ;;
        esac
    done

    if [[ -z "$name" || -z "$prompt" || -z "$dir" ]]; then
        echo "Error: --name, --prompt, and --dir are required" >&2
        usage >&2
        exit 1
    fi

    mkdir -p "$RESULTS_DIR"

    local output_file="$RESULTS_DIR/${name}.json"
    local summary_file="$RESULTS_DIR/${name}.summary.json"

    echo "Running test case: $name"
    echo "  Prompt: ${prompt:0:60}..."
    echo "  Directory: $dir"
    echo "  Timeout: ${timeout_secs}s"

    local start_time end_time duration_ms
    start_time=$(date +%s%3N)

    # Build command
    local cmd=(opencode run --attach "http://localhost:$PORT" --format json --dir "$dir")
    if [[ -n "$session_id" ]]; then
        cmd+=(--session "$session_id")
    fi
    cmd+=("$prompt")

    # Run with timeout
    local exit_code=0
    if ! timeout "$timeout_secs" "${cmd[@]}" > "$output_file" 2>&1; then
        exit_code=$?
        if [[ $exit_code -eq 124 ]]; then
            echo -e "${YELLOW}Test timed out after ${timeout_secs}s${NC}"
            exit_code=1
        else
            echo -e "${RED}Test failed with exit code $exit_code${NC}" >&2
            exit_code=2
        fi
    fi

    end_time=$(date +%s%3N)
    duration_ms=$((end_time - start_time))

    # Parse JSON output
    local session_id_found=""
    local text_content=""
    local skills_loaded="[]"
    local tools_used="[]"
    local finish_reason=""

    if [[ -s "$output_file" ]]; then
        # Extract session ID from first step_start event
        session_id_found=$(jq -r '[.[] | select(.type == "step_start")][0].session_id // empty' "$output_file" 2>/dev/null || true)

        # Extract all text content
        text_content=$(jq -r '[.[] | select(.type == "text") | .text] | join("")' "$output_file" 2>/dev/null || true)

        # Extract skills loaded from tool_use events where tool=skill
        skills_loaded=$(jq -r '[.[] | select(.type == "tool_use" and .tool == "skill") | .input.name // empty] | unique' "$output_file" 2>/dev/null || true)

        # Extract all tool calls
        tools_used=$(jq -r '[.[] | select(.type == "tool_use") | .tool] | unique' "$output_file" 2>/dev/null || true)

        # Extract finish reason from step_finish event
        finish_reason=$(jq -r '[.[] | select(.type == "step_finish")][0].finish_reason // empty' "$output_file" 2>/dev/null || true)
    fi

    # Write summary
    cat > "$summary_file" <<EOF
{
  "name": "$name",
  "session_id": "${session_id_found:-\"\"}",
  "text": $(echo "$text_content" | jq -R -s .),
  "skills_loaded": ${skills_loaded:-[]},
  "tools_used": ${tools_used:-[]},
  "finish_reason": "${finish_reason:-\"\"}",
  "duration_ms": $duration_ms,
  "prompt": $(echo "$prompt" | jq -R -s .)
}
EOF

    # Check expected skills
    if [[ -n "$expect_skills" ]]; then
        local pass=true
        IFS=',' read -ra expected_array <<< "$expect_skills"
        for skill in "${expected_array[@]}"; do
            skill=$(echo "$skill" | xargs) # trim whitespace
            if [[ -z "$skill" ]]; then
                continue
            fi
            if ! echo "$skills_loaded" | jq -e "contains([\"$skill\"])" > /dev/null 2>&1; then
                echo -e "${RED}FAIL: Expected skill '$skill' not loaded${NC}"
                pass=false
            fi
        done

        # Also check that no unexpected skills were loaded when expecting none
        if [[ "$expect_skills" == "" ]]; then
            local skills_count
            skills_count=$(echo "$skills_loaded" | jq 'length')
            if [[ "$skills_count" -gt 0 ]]; then
                echo -e "${YELLOW}WARNING: Expected no skills but found: $skills_loaded${NC}"
                pass=false
            fi
        fi

        if $pass; then
            echo -e "${GREEN}PASS: All expected skills loaded correctly${NC}"
        fi
    fi

    echo "  Output: $output_file"
    echo "  Summary: $summary_file"
    echo "  Duration: ${duration_ms}ms"

    return $exit_code
}

cmd_test() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --port)
                PORT="$2"
                shift 2
                ;;
            *)
                echo "Unknown option: $1" >&2
                usage >&2
                exit 1
                ;;
        esac
    done

    # Clean results directory
    rm -rf "$RESULTS_DIR"
    mkdir -p "$RESULTS_DIR"

    # Ensure test project exists
    if [[ ! -d "/tmp/todo-app" ]]; then
        echo "Creating test project at /tmp/todo-app..."
        mkdir -p /tmp/todo-app/src
        cat > /tmp/todo-app/src/style.css <<'EOF'
.todo-app {
  backgroud: white;
  color: black;
}
EOF
    fi

    # Start server if not running
    if [[ ! -f "$PID_FILE" ]] || ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        cmd_start --port "$PORT"
    fi

    echo ""
    echo "========================================"
    echo "Running ACP Skill Routing Tests"
    echo "========================================"
    echo ""

    # Test results array
    declare -a results

    # Test 1: Trivial
    echo "--- Test 1: trivial ---"
    if cmd_run --name trivial \
        --prompt "What is 2+2? Just give me the number." \
        --dir /tmp/todo-app \
        --timeout 60 \
        --expect-skills ""; then
        results+=("trivial|PASS")
    else
        results+=("trivial|FAIL")
    fi
    echo ""

    # Test 2: Trivial Bug
    echo "--- Test 2: trivial-bug ---"
    if cmd_run --name trivial-bug \
        --prompt "Fix the typo in /tmp/todo-app/src/style.css where it says 'backgroud' instead of 'background'" \
        --dir /tmp/todo-app \
        --timeout 120 \
        --expect-skills ""; then
        results+=("trivial-bug|PASS")
    else
        results+=("trivial-bug|FAIL")
    fi
    echo ""

    # Test 3: Standard Bug
    echo "--- Test 3: standard-bug ---"
    if cmd_run --name standard-bug \
        --prompt "The todo app filters don't work correctly. When I click 'Active' filter, completed items still show. Debug and fix it." \
        --dir /tmp/todo-app \
        --timeout 180 \
        --expect-skills "diagnose"; then
        results+=("standard-bug|PASS")
    else
        results+=("standard-bug|FAIL")
    fi
    echo ""

    # Test 4: Small Change
    echo "--- Test 4: small-change ---"
    if cmd_run --name small-change \
        --prompt "Add a button to the todo app that toggles all todos between completed and uncompleted" \
        --dir /tmp/todo-app \
        --timeout 120 \
        --expect-skills "interview"; then
        results+=("small-change|PASS")
    else
        results+=("small-change|FAIL")
    fi
    echo ""

    # Test 5: Feature
    echo "--- Test 5: feature ---"
    if cmd_run --name feature \
        --prompt "Add dark mode support to the todo app with a toggle button in the header. It should persist the preference in localStorage" \
        --dir /tmp/todo-app \
        --timeout 300 \
        --expect-skills "interview"; then
        results+=("feature|PASS")
    else
        results+=("feature|FAIL")
    fi
    echo ""

    # Print summary table
    echo "========================================"
    echo "Test Results Summary"
    echo "========================================"
    printf "%-18s | %-16s | %-16s | %-10s | %-6s\n" "Test Case" "Skills Expected" "Skills Loaded" "Duration" "Result"
    printf "%-18s-+-%-16s-+-%-16s-+-%-10s-+-%-6s\n" "------------------" "----------------" "----------------" "----------" "------"

    local total_passed=0
    local total_failed=0

    for result in "${results[@]}"; do
        local test_name test_result
        test_name="${result%%|*}"
        test_result="${result##*|}"

        # Read summary
        local summary_file="$RESULTS_DIR/${test_name}.summary.json"
        local skills_loaded duration_ms
        skills_loaded="(none)"
        duration_ms="0"

        if [[ -f "$summary_file" ]]; then
            skills_loaded=$(jq -r '[.skills_loaded[]] | if length > 0 then join(", ") else "(none)" end' "$summary_file" 2>/dev/null || echo "(none)")
            duration_ms=$(jq -r '.duration_ms // 0' "$summary_file" 2>/dev/null || echo "0")
        fi

        local expected_skills=""
        case "$test_name" in
            trivial) expected_skills="(none)" ;;
            trivial-bug) expected_skills="(none)" ;;
            standard-bug) expected_skills="diagnose" ;;
            small-change) expected_skills="interview" ;;
            feature) expected_skills="interview" ;;
        esac

        local duration_sec
        duration_sec=$(echo "scale=1; $duration_ms / 1000" | bc 2>/dev/null || echo "0")

        if [[ "$test_result" == "PASS" ]]; then
            printf "%-18s | %-16s | %-16s | %-10s | ${GREEN}%-6s${NC}\n" "$test_name" "$expected_skills" "$skills_loaded" "${duration_sec}s" "PASS"
            ((total_passed++))
        else
            printf "%-18s | %-16s | %-16s | %-10s | ${RED}%-6s${NC}\n" "$test_name" "$expected_skills" "$skills_loaded" "${duration_sec}s" "FAIL"
            ((total_failed++))
        fi
    done

    echo ""
    echo "Total: $total_passed passed, $total_failed failed"

    if [[ $total_failed -gt 0 ]]; then
        return 1
    fi
    return 0
}

# Main
main() {
    if [[ $# -eq 0 ]]; then
        usage >&2
        exit 1
    fi

    local command="$1"
    shift

    case "$command" in
        start)
            cmd_start "$@"
            ;;
        stop)
            cmd_stop "$@"
            ;;
        run)
            cmd_run "$@"
            ;;
        test)
            cmd_test "$@"
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "Unknown command: $command" >&2
            usage >&2
            exit 1
            ;;
    esac
}

main "$@"
