export class TestHarness {
  private readonly cases: Array<{ name: string; run: () => Promise<void> | void }> = [];
  private assertions = 0;

  test(name: string, run: () => Promise<void> | void): void {
    this.cases.push({ name, run });
  }

  assert(value: unknown, message: string): asserts value {
    this.assertions += 1;
    if (!value) throw new Error(message);
  }

  equal<T>(actual: T, expected: T, message: string): void {
    this.assertions += 1;
    if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }

  deepEqual(actual: unknown, expected: unknown, message: string): void {
    this.assertions += 1;
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    if (actualJson !== expectedJson) throw new Error(`${message}: expected ${expectedJson}, received ${actualJson}`);
  }
  async rejects(operation: () => Promise<unknown>, code: string, message: string): Promise<void> {
    try {
      await operation();
    } catch (error) {
      this.assert(error instanceof Error, `${message}: should be Error`);
      this.equal((error as { code?: string }).code, code, `${message}: code`);
      return;
    }
    throw new Error(`${message}: expected rejection`);
  }

  async run(): Promise<{ testCount: number; assertionCount: number }> {
    for (const testCase of this.cases) {
      await testCase.run();
      console.log(`ok - ${testCase.name}`);
    }
    return { testCount: this.cases.length, assertionCount: this.assertions };
  }
}
