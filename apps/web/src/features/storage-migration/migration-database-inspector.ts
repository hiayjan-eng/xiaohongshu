export interface IndexedDbDatabaseInspector {
  isSupported(): boolean;
  exists(databaseName: string): Promise<boolean>;
}

interface IndexedDbFactoryWithDatabases {
  databases?: () => Promise<Array<{ name?: string; version?: number }>>;
}

export function createBrowserIndexedDbDatabaseInspector(
  factory: IndexedDbFactoryWithDatabases | undefined = readIndexedDbFactory()
): IndexedDbDatabaseInspector {
  return {
    isSupported: () => typeof factory?.databases === "function",
    async exists(databaseName) {
      if (typeof factory?.databases !== "function") return false;
      const databases = await factory.databases();
      return databases.some((database) => database.name === databaseName);
    }
  };
}

function readIndexedDbFactory(): IndexedDbFactoryWithDatabases | undefined {
  return typeof globalThis.indexedDB === "undefined"
    ? undefined
    : globalThis.indexedDB as IndexedDbFactoryWithDatabases;
}
