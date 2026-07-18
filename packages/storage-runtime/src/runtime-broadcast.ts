export const STORAGE_RUNTIME_BROADCAST_CHANNEL = "collection-revival-storage-runtime:v1";

export type StorageRuntimeBroadcastMessage =
  | { type: "activation_preflight_started"; activationId: string; revision: number }
  | { type: "activation_prepared"; activationId: string; revision: number }
  | { type: "activation_prepare_cancelled"; activationId: string; revision: number };

export interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  close(): void;
}

export class StorageRuntimeBroadcast {
  private readonly listeners = new Set<(message: StorageRuntimeBroadcastMessage) => void>();
  private readonly onMessage = (event: MessageEvent): void => {
    if (!isStorageRuntimeBroadcastMessage(event.data)) return;
    for (const listener of this.listeners) listener(event.data);
  };

  constructor(private readonly channel?: BroadcastChannelLike) {
    this.channel?.addEventListener("message", this.onMessage);
  }

  get available(): boolean { return Boolean(this.channel); }
  publish(message: StorageRuntimeBroadcastMessage): void { this.channel?.postMessage(message); }
  subscribe(listener: (message: StorageRuntimeBroadcastMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  close(): void {
    this.channel?.removeEventListener("message", this.onMessage);
    this.channel?.close();
    this.listeners.clear();
  }
}

export function createBrowserStorageRuntimeBroadcast(): StorageRuntimeBroadcast {
  const Constructor = typeof BroadcastChannel === "undefined" ? undefined : BroadcastChannel;
  return new StorageRuntimeBroadcast(Constructor ? new Constructor(STORAGE_RUNTIME_BROADCAST_CHANNEL) : undefined);
}

export function isStorageRuntimeBroadcastMessage(value: unknown): value is StorageRuntimeBroadcastMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StorageRuntimeBroadcastMessage>;
  return (candidate.type === "activation_preflight_started" || candidate.type === "activation_prepared" || candidate.type === "activation_prepare_cancelled") &&
    typeof candidate.activationId === "string" && candidate.activationId.length > 0 &&
    Number.isInteger(candidate.revision) && Number(candidate.revision) >= 0;
}