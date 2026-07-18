import { canonicalRuntimeValue, type RuntimeStateBundle } from "./app-state-codec";

export interface RuntimeEquivalenceDifference {
  path: string;
  kind: "missing" | "extra" | "type" | "value" | "order";
}

export interface RuntimeEquivalenceResult {
  equivalent: boolean;
  differences: RuntimeEquivalenceDifference[];
}

export function compareRuntimeStateBundles(
  expected: RuntimeStateBundle,
  actual: RuntimeStateBundle,
  maximumDifferences = 100
): RuntimeEquivalenceResult {
  if (canonicalRuntimeValue(expected) === canonicalRuntimeValue(actual)) return { equivalent: true, differences: [] };
  const differences: RuntimeEquivalenceDifference[] = [];
  compareValue(expected, actual, "$", differences, maximumDifferences);
  return { equivalent: false, differences };
}

export function shadowCompareRuntimeStates(
  authoritative: RuntimeStateBundle,
  candidate: RuntimeStateBundle
): RuntimeEquivalenceResult {
  return compareRuntimeStateBundles(authoritative, candidate);
}

function compareValue(
  expected: unknown,
  actual: unknown,
  path: string,
  output: RuntimeEquivalenceDifference[],
  limit: number
): void {
  if (output.length >= limit || Object.is(expected, actual)) return;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) output.push({ path, kind: expected.length > actual.length ? "missing" : "extra" });
    const length = Math.min(expected.length, actual.length);
    for (let index = 0; index < length && output.length < limit; index += 1) {
      if (isRecordWithId(expected[index]) && isRecordWithId(actual[index]) && expected[index].id !== actual[index].id) {
        output.push({ path: `${path}[${index}]`, kind: "order" });
      } else {
        compareValue(expected[index], actual[index], `${path}[${index}]`, output, limit);
      }
    }
    return;
  }
  if (isPlainRecord(expected) && isPlainRecord(actual)) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of keys) {
      if (output.length >= limit) break;
      if (!(key in actual)) output.push({ path: `${path}.${key}`, kind: "missing" });
      else if (!(key in expected)) output.push({ path: `${path}.${key}`, kind: "extra" });
      else compareValue(expected[key], actual[key], `${path}.${key}`, output, limit);
    }
    return;
  }
  output.push({ path, kind: typeof expected === typeof actual ? "value" : "type" });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRecordWithId(value: unknown): value is { id: string } {
  return isPlainRecord(value) && typeof value.id === "string";
}
