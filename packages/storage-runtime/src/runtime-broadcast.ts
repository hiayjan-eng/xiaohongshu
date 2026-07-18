export const STORAGE_RUNTIME_BROADCAST_CHANNEL = "collection-revival-storage-runtime:v1";
export const STORAGE_RUNTIME_STORAGE_EVENT_KEY = "collection-revival-storage-runtime-event:v1";

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

export interface StorageEventWindowLike {
  addEventListener(type: "storage", listener: (event: StorageEvent) => void): void;
  removeEventListener(type: "storage", listener: (event: StorageEvent) => void): void;
}

export interface RuntimeBroadcastStorageLike {
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
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
  if (Constructor) return new StorageRuntimeBroadcast(new Constructor(STORAGE_RUNTIME_BROADCAST_CHANNEL));
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    return new StorageRuntimeBroadcast(new StorageEventBroadcastChannel(window, localStorage));
  }
  return new StorageRuntimeBroadcast();
}

export class StorageEventBroadcastChannel implements BroadcastChannelLike {
  private readonly listeners = new Set<(event: MessageEvent) => void>();
  private readonly onStorage = (event: StorageEvent): void => {
    if (event.key !== STORAGE_RUNTIME_STORAGE_EVENT_KEY || !event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue) as { message?: unknown };
      for (const listener of this.listeners) listener({ data: parsed.message } as MessageEvent);
    } catch {
      // Malformed notification payloads are ignored; they never carry product data.
    }
  };

  constructor(
    private readonly eventWindow: StorageEventWindowLike,
    private readonly storage: RuntimeBroadcastStorageLike
  ) {
    this.eventWindow.addEventListener("storage", this.onStorage);
  }

  postMessage(message: unknown): void {
    const payload = JSON.stringify({ nonce: cryptoRandomId(), message });
    this.storage.setItem(STORAGE_RUNTIME_STORAGE_EVENT_KEY, payload);
    this.storage.removeItem(STORAGE_RUNTIME_STORAGE_EVENT_KEY);
  }

  addEventListener(_type: "message", listener: (event: MessageEvent) => void): void { this.listeners.add(listener); }
  removeEventListener(_type: "message", listener: (event: MessageEvent) => void): void { this.listeners.delete(listener); }
  close(): void {
    this.eventWindow.removeEventListener("storage", this.onStorage);
    this.listeners.clear();
  }
}

function cryptoRandomId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  return typeof randomUUID === "function" ? randomUUID.call(globalThis.crypto) : `${Date.now()}-${Math.random()}`;
}

export function isStorageRuntimeBroadcastMessage(value: unknown): value is StorageRuntimeBroadcastMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StorageRuntimeBroadcastMessage>;
  return (candidate.type === "activation_preflight_started" || candidate.type === "activation_prepared" || candidate.type === "activation_prepare_cancelled") &&
    typeof candidate.activationId === "string" && candidate.activationId.length > 0 &&
    Number.isInteger(candidate.revision) && Number(candidate.revision) >= 0;
}