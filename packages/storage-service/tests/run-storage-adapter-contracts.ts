import { MEMORY_TARGET_CAPABILITIES, createMemoryAdapter } from "../src/index";
import { getContractCaseCount, runStorageAdapterContractTests } from "./adapter-contract-suite";
import { getIndexedDbSpecificCaseCount, runIndexedDbAdapterContractTests, runIndexedDbAdapterSpecificTests } from "./indexeddb-adapter.spec";
import { getMemorySpecificCaseCount, runMemoryAdapterSpecificTests } from "./memory-adapter.spec";
import { TestHarness } from "./test-harness";

async function main(): Promise<void> {
  const harness = new TestHarness();

  runStorageAdapterContractTests(harness, {
    name: "MemoryAdapter",
    createAdapter: () => createMemoryAdapter(),
    expectedCapabilities: MEMORY_TARGET_CAPABILITIES
  });
  runMemoryAdapterSpecificTests(harness);
  runIndexedDbAdapterContractTests(harness);
  runIndexedDbAdapterSpecificTests(harness);

  const result = await harness.run();
  console.log(`storage adapter contract suite: ${result.testCount} tests, ${result.assertionCount} assertions`);
  console.log(`registered coverage: ${getContractCaseCount()} contract cases, ${getMemorySpecificCaseCount()} memory-specific cases, ${getIndexedDbSpecificCaseCount()} indexeddb-specific cases`);
}

void main().catch((error) => {
  console.error(error);
  throw error;
});
