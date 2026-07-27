import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerError, parseArgs, readInputFile, redactSensitiveText, runTask, safeErrorResponse } from "./worker.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "deepseek-worker-test-"));
const fixture = path.join(root, "synthetic-test.log");
const secret = "sk-super-secret-token-123456";
const config = { DEEPSEEK_API_KEY: secret, DEEPSEEK_BASE_URL: "https://mock.deepseek.invalid", DEEPSEEK_MODEL: "mock-model" };
let passed = 0;
async function test(name, operation) { try { await operation(); passed += 1; } catch (error) { error.message = `${name}: ${error.message}`; throw error; } }
async function rejects(operation, code) { await assert.rejects(operation, (error) => error instanceof WorkerError && error.code === code); }
function response(content, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => ({ choices: [{ message: { content } }] }) }; }
const validSummary = JSON.stringify({ task: "summarize-test-log", summary: "One test failed.", findings: [{ severity: "error", message: "Synthetic failure." }], confidence: 0.8, reviewRequired: true });

try {
  await writeFile(fixture, "PASS unit test\nFAIL synthetic case\n", "utf8");
  await test("dry run avoids fetch", async () => {
    let calls = 0;
    const result = await runTask({ type: "summarize-test-log", input: fixture, dryRun: true }, { fetchImpl: async () => { calls += 1; throw new Error("must not fetch"); } });
    assert.equal(result.status, "dry_run"); assert.equal(calls, 0);
  });
  await test("missing key fails safely", async () => rejects(() => runTask({ type: "summarize-test-log", input: fixture, dryRun: false }, { environment: {}, fetchImpl: async () => response(validSummary) }), "DEEPSEEK_KEY_MISSING"));
  await test("unknown task is rejected", async () => assert.throws(() => parseArgs(["--type", "delete-repository", "--input", fixture]), (error) => error.code === "TASK_NOT_ALLOWED"));
  await test("bad input files are rejected", async () => {
    await rejects(() => readInputFile(path.join(root, "missing.log")), "INPUT_UNAVAILABLE");
    const empty = path.join(root, "empty.log"), binary = path.join(root, "binary.log"), huge = path.join(root, "huge.log"), directory = path.join(root, "directory");
    await Promise.all([writeFile(empty, ""), writeFile(binary, Buffer.from([1, 0, 2])), writeFile(huge, Buffer.alloc(256 * 1024 + 1, "a")), mkdir(directory)]);
    await rejects(() => readInputFile(empty), "INPUT_EMPTY"); await rejects(() => readInputFile(binary), "INPUT_BINARY"); await rejects(() => readInputFile(huge), "INPUT_TOO_LARGE"); await rejects(() => readInputFile(directory), "INPUT_NOT_TEXT_FILE");
  });
  await test("sensitive text is redacted", async () => {
    const redacted = redactSensitiveText(`key=${secret} Bearer token@example.com C:\\Users\\alice\\work`, secret);
    assert(!redacted.includes(secret)); assert(!redacted.includes("token@example.com")); assert(!redacted.includes("C:\\Users\\alice")); assert(redacted.includes("Bearer [REDACTED]"));
  });
  await test("valid JSON passes local schema validation", async () => {
    const result = await runTask({ type: "summarize-test-log", input: fixture, dryRun: false }, { environment: config, fetchImpl: async () => response(validSummary) });
    assert.equal(result.result.reviewRequired, true);
  });
  for (const [name, content] of [["invalid JSON", "not-json"], ["confidence bounds", JSON.stringify({ task: "summarize-test-log", summary: "x", findings: [], confidence: 1.1, reviewRequired: true })], ["review requirement", JSON.stringify({ task: "summarize-test-log", summary: "x", findings: [], confidence: 0.5, reviewRequired: false })], ["tool calls ignored", JSON.stringify({ task: "summarize-test-log", summary: "x", findings: [], confidence: 0.5, reviewRequired: true, tool_calls: [{ command: "rm -rf" }] })]]) {
    await test(`${name} is rejected`, async () => rejects(() => runTask({ type: "summarize-test-log", input: fixture, dryRun: false }, { environment: config, fetchImpl: async () => response(content) }), "MODEL_OUTPUT_INVALID"));
  }
  for (const [status, code] of [[401, "API_UNAUTHORIZED"], [429, "API_RATE_LIMITED"], [500, "API_SERVER_ERROR"]]) {
    await test(`HTTP ${status} fails safely`, async () => rejects(() => runTask({ type: "summarize-test-log", input: fixture, dryRun: false }, { environment: config, fetchImpl: async () => response("{}", status) }), code));
  }
  await test("timeouts fail safely", async () => { const abort = new Error("aborted"); abort.name = "AbortError"; await rejects(() => runTask({ type: "summarize-test-log", input: fixture, dryRun: false }, { environment: config, fetchImpl: async () => { throw abort; } }), "API_TIMEOUT"); });
  await test("CLI output never exposes a configured key", async () => {
    const worker = path.join(path.dirname(fileURLToPath(import.meta.url)), "worker.mjs"); let output = "";
    try { execFileSync(process.execPath, [worker, "--type", "summarize-test-log", "--input", fixture], { env: { ...process.env, DEEPSEEK_API_KEY: secret }, encoding: "utf8", stdio: "pipe" }); }
    catch (error) { output = `${error.stdout}${error.stderr}`; }
    assert(!output.includes(secret)); assert.doesNotThrow(() => JSON.parse(output.trim()));
  });
  const safe = JSON.stringify(safeErrorResponse(new Error(`Bearer ${secret}`), secret));
  assert(!safe.includes(secret));
  console.log(`${passed} deepseek worker tests passed`);
} finally { await rm(root, { recursive: true, force: true }); }
