import { ActivationError } from "./activation-errors";

export type StorageWriteGateState =
  | "open"
  | "activation_preflight"
  | "activation_prepared"
  | "activation_switching"
  | "indexeddb_active";
export type StorageWriteGateListener = (state: StorageWriteGateState) => void;

export class StorageWriteGate {
  private current: StorageWriteGateState;
  private readonly listeners = new Set<StorageWriteGateListener>();

  constructor(initial: StorageWriteGateState = "open") {
    this.current = initial;
  }

  get state(): StorageWriteGateState { return this.current; }
  get writable(): boolean { return this.current === "open"; }

  enterPreflight(): void { this.setState("activation_preflight"); }
  markPrepared(): void { this.setState("activation_prepared"); }
  reopen(): void { this.setState("open"); }

  assertWritable(): void {
    if (!this.writable) {
      const code = this.current === "activation_switching" || this.current === "indexeddb_active"
        ? "ACTIVATION_OLD_TAB_WRITE_BLOCKED"
        : "ACTIVATION_WRITE_GATE_FAILED";
      throw new ActivationError({ code, recoverable: true });
    }
  }

  subscribe(listener: StorageWriteGateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(next: StorageWriteGateState): void {
    if (this.current === next) return;
    if ((this.current === "activation_prepared" || this.current === "activation_switching" || this.current === "indexeddb_active") &&
        next === "activation_preflight") {
      throw new ActivationError({ code: "ACTIVATION_WRITE_GATE_FAILED", recoverable: false });
    }
    this.current = next;
    for (const listener of this.listeners) listener(next);
  }
}