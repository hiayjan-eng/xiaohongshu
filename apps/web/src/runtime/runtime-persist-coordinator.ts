import type {
  ActiveStorageRuntime,
  StorageRuntimeProductSettings,
  StorageWriteGate
} from "@revival/storage-runtime";
import type { AppState } from "@revival/shared-types";

export type RuntimePersistStatus =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; persistedAt: string }
  | { status: "failed"; code: string };

export class RuntimePersistCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(
    private readonly runtime: ActiveStorageRuntime,
    private readonly onStatusChange: (status: RuntimePersistStatus) => void,
    private readonly writeGate?: StorageWriteGate
  ) {}

  enqueueAppState(previous: AppState, next: AppState): Promise<void> {
    return this.enqueue(async () => {
      const result = await this.runtime.persistAppState(previous, next);
      return result.persistedAt;
    });
  }

  enqueueProductSettings(
    previous: StorageRuntimeProductSettings,
    next: StorageRuntimeProductSettings
  ): Promise<void> {
    return this.enqueue(async () => {
      const result = await this.runtime.persistProductSettings(previous, next);
      return result.persistedAt;
    });
  }

  flush(): Promise<void> {
    return this.tail;
  }

  async freezeForActivationPreflight(): Promise<void> {
    this.writeGate?.enterPreflight();
    await this.flush();
  }

  dispose(): void {
    this.disposed = true;
  }

  activate(): void {
    this.disposed = false;
  }

  private enqueue(operation: () => Promise<string>): Promise<void> {
    this.writeGate?.assertWritable();
    const queued = this.tail.then(async () => {
      this.emit({ status: "saving" });
      try {
        const persistedAt = await operation();
        this.emit({ status: "saved", persistedAt });
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error
          ? String((error as { code: unknown }).code)
          : "RUNTIME_PERSIST_FAILED";
        this.emit({ status: "failed", code });
        throw error;
      }
    });
    this.tail = queued.catch(() => undefined);
    return queued;
  }

  private emit(status: RuntimePersistStatus): void {
    if (!this.disposed) this.onStatusChange(status);
  }
}
