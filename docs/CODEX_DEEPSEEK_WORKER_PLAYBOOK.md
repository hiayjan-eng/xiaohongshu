# Codex and DeepSeek development-worker playbook

Codex remains responsible for architecture, key implementation decisions, tests, Git operations, release work, deployment decisions, and final review. The DeepSeek development worker is only an optional helper for narrow, low-risk, reviewable transformations: summarizing a pre-sanitized test log or drafting a changelog from one explicitly selected text file.

The worker is isolated at `scripts/deepseek-worker/`. It is not part of the product runtime or the web bundle. It scans no repository paths, executes no shell or Git command, writes no file, and accepts only `summarize-test-log` and `draft-changelog`. Its normal output is strict JSON and every accepted model result requires local schema validation plus `reviewRequired: true`.

Before use, prepare a synthetic or already-sanitized text fixture. Never upload real saved collections, user identifiers, authentication material, API keys, migration or activation evidence, recovery journals, raw production logs, or any other sensitive data. Start with `--dry-run`, which does not send a network request and does not require a key.

If an explicitly authorized non-dry run is later needed, supply `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, and `DEEPSEEK_MODEL` only through the environment. The worker redacts key-like values, Bearer tokens, email addresses, and Windows user directories; it never prints the configured key. Missing credentials, invalid output, HTTP 401/429/5xx responses, and timeouts fail safely, while Codex continues normal work without depending on the worker.

Treat every result as a draft. Do not use it to execute commands, invoke tools, edit code, modify storage, change migration or activation state, perform recovery, commit, push, merge, or deploy. Those actions remain under Codex control and require the normal review path.
