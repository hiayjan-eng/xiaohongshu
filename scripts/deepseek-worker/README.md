# Guarded DeepSeek development worker

This directory is an independent development-only CLI. It is not imported by any application package or web bundle, and it does not modify code, data, Git state, or files.

Supported tasks are deliberately limited to `summarize-test-log` and `draft-changelog`. The worker reads exactly the file supplied through `--input`; it does not search or scan the repository. Inputs must be a regular UTF-8 text file no larger than 256 KiB. Empty, binary, directory, symlink, missing, and oversized inputs are rejected.

Use a dry run to validate the task and input boundary without making any network request:

```bash
pnpm deepseek:task --type summarize-test-log --input scripts/deepseek-worker/fixtures/synthetic-test.txt --dry-run
```

For an intentionally authorized non-dry run, configure all three variables outside the repository: `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, and `DEEPSEEK_MODEL`. Keys are never hard-coded or logged. The worker redacts API-key-shaped strings, Bearer tokens, email addresses, and Windows user directories before sending the allowed input.

The CLI writes a single JSON object to stdout on success and a single JSON error object to stderr on failure. A model result is accepted only when it is valid JSON, matches the task-specific schema, has `confidence` from 0 through 1, and sets `reviewRequired` to `true`. It never executes model-returned commands or tool calls.

Run its isolated mock-fetch checks with:

```bash
pnpm test:deepseek-worker
```

Do not submit real saved-item data, user identities, credentials, migration evidence, production logs, or other sensitive material to this worker.