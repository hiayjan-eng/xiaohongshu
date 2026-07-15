export type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

export class TestHarness {
  private readonly cases: TestCase[] = [];
  private assertionCount = 0;

  test(name: string, run: TestCase["run"]): void {
    this.cases.push({ name, run });
  }

  async run(): Promise<{ testCount: number; assertionCount: number }> {
    for (const testCase of this.cases) {
      try {
        await testCase.run();
        console.log(`ok - ${testCase.name}`);
      } catch (error) {
        console.error(`not ok - ${testCase.name}`);
        throw error;
      }
    }

    return {
      testCount: this.cases.length,
      assertionCount: this.assertionCount
    };
  }

  assert(condition: unknown, message: string): asserts condition {
    this.assertionCount += 1;
    if (!condition) {
      throw new Error(message);
    }
  }

  equal<T>(actual: T, expected: T, message: string): void {
    this.assertionCount += 1;
    if (actual !== expected) {
      throw new Error(`${message}. Expected ${String(expected)}, received ${String(actual)}.`);
    }
  }

  deepEqual(actual: unknown, expected: unknown, message: string): void {
    this.assertionCount += 1;
    const actualJson = stableStringify(actual);
    const expectedJson = stableStringify(expected);
    if (actualJson !== expectedJson) {
      throw new Error(`${message}. Expected ${expectedJson}, received ${actualJson}.`);
    }
  }
}

export async function expectStorageError(
  harness: TestHarness,
  operation: () => Promise<unknown>,
  code: string,
  message: string
): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    harness.assert(error instanceof Error, `${message}: error should inherit Error`);
    harness.equal((error as { code?: string }).code, code, `${message}: error code`);
    return error;
  }

  throw new Error(`${message}: expected ${code}`);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;

  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = sortObject((value as Record<string, unknown>)[key]);
      return result;
    }, {});
}
