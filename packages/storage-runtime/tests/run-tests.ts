import { registerLocalStorageRuntimeTests } from "./local-storage-runtime.spec";
import { TestHarness } from "./test-harness";

async function main(): Promise<void> {
  const harness = new TestHarness();
  registerLocalStorageRuntimeTests(harness);
  const result = await harness.run();
  console.log(`${result.testCount} tests / ${result.assertionCount} assertions passed`);
}

void main();
