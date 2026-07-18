import { MEMORY_TARGET_CAPABILITIES, createMemoryAdapter } from "../src/index";
import { getActivationJournalCaseCount, runActivationJournalTests } from "./activation-journal.spec";
import { getContractCaseCount, runStorageAdapterContractTests } from "./adapter-contract-suite";
import { getIndexedDbSpecificCaseCount, runIndexedDbAdapterContractTests, runIndexedDbAdapterSpecificTests } from "./indexeddb-adapter.spec";
import { getLegacyLocalStorageSnapshotCaseCount, runLegacyLocalStorageSnapshotTests } from "./legacy-localstorage-snapshot.spec";
import { getMemorySpecificCaseCount, runMemoryAdapterSpecificTests } from "./memory-adapter.spec";
import { getMigrationExecutorCaseCount, runMigrationExecutorTests } from "./migration-executor.spec";
import { getMigrationLockCaseCount, runMigrationLockTests } from "./migration-lock.spec";
import { getMigrationPreviewCaseCount, runMigrationPreviewTests } from "./migration-preview.spec";
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
  runLegacyLocalStorageSnapshotTests(harness);
  runMigrationPreviewTests(harness);
  runMigrationLockTests(harness);
  runMigrationExecutorTests(harness);
  runActivationJournalTests(harness);

  const result = await harness.run();
  console.log(`storage adapter contract suite: ${result.testCount} tests, ${result.assertionCount} assertions`);
  console.log(`registered coverage: ${getContractCaseCount()} contract cases, ${getMemorySpecificCaseCount()} memory-specific cases, ${getIndexedDbSpecificCaseCount()} indexeddb-specific cases, ${getLegacyLocalStorageSnapshotCaseCount()} legacy snapshot cases, ${getMigrationPreviewCaseCount()} migration preview cases, ${getMigrationLockCaseCount()} migration lock cases, ${getMigrationExecutorCaseCount()} migration executor cases, ${getActivationJournalCaseCount()} activation journal cases`);
}

void main().catch((error) => {
  console.error(error);
  throw error;
});
