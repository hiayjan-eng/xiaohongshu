import { registerActivationPrepareTests } from "./activation-prepare.spec";
import { registerActivationPrimitiveTests } from "./activation-primitives.spec";
import { registerIndexedDbRuntimeTests } from "./indexeddb-runtime.spec";
import { registerLocalStorageRuntimeTests } from "./local-storage-runtime.spec";
import { TestHarness } from "./test-harness";

async function main(): Promise<void> {
  const harness = new TestHarness();
  registerLocalStorageRuntimeTests(harness);
  registerIndexedDbRuntimeTests(harness);
  registerActivationPrimitiveTests(harness);
  registerActivationPrepareTests(harness);
  const result = await harness.run();
  console.log(`${result.testCount} tests / ${result.assertionCount} assertions passed`);
}

void main();
