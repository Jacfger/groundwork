# Learnings

- **Agent skill invocation is advisory**: The agent reads groundwork bootstrap rules and correctly classifies issue types (mentions "trivial small change", "standard bug", etc.) but does NOT invoke the `skill` tool to load corresponding skills. It treats routing rules as guidance and often decides the task is "specified enough" to implement directly. Detected via ACP routing tests: trivial (PASS), trivial-bug (OK), standard-bug (FAIL — no diagnose), small-change (FAIL — no interview), feature (FAIL — no interview).
- **ACP server must run via PTY**: `opencode acp` backgrounded from bash dies silently. Must start via `pty_spawn` for the process to survive. The `acp-harness.sh` `start` command has this limitation documented.
