import type { ShareInput } from "@revival/shared-types";

export type MobileShareSource = "ios-share-extension" | "android-send-intent" | "manual-prototype";

export interface IncomingSharePayload {
  source: MobileShareSource;
  url?: string;
  title?: string;
  text?: string;
  userNote?: string;
  receivedAt?: string;
}

export interface NormalizedSharePayload extends ShareInput {
  receivedAt: string;
  source: MobileShareSource;
}

export const mobileShareTargetCapabilities = {
  ios: {
    extensionPoint: "com.apple.share-services",
    accepts: ["public.url", "public.plain-text"],
    multipleItems: false
  },
  android: {
    intentActions: ["android.intent.action.SEND"],
    mimeTypes: ["text/plain"],
    multipleItems: false
  }
} as const;

export function normalizeIncomingShare(payload: IncomingSharePayload): NormalizedSharePayload {
  const extractedUrl = payload.url ?? extractFirstUrl(payload.text ?? "");
  const textWithoutUrl = (payload.text ?? "").replace(extractedUrl ?? "", "").trim();

  return {
    source: payload.source,
    receivedAt: payload.receivedAt ?? new Date().toISOString(),
    sourceUrl: extractedUrl ?? "",
    title: (payload.title ?? inferTitle(textWithoutUrl)).trim(),
    rawShareText: textWithoutUrl,
    userNote: (payload.userNote ?? "").trim()
  };
}

export function canAcceptShare(payload: IncomingSharePayload): boolean {
  return Boolean(payload.url || extractFirstUrl(payload.text ?? "") || payload.title || payload.text);
}

function extractFirstUrl(text: string): string | undefined {
  return text.match(/https?:\/\/\S+/)?.[0];
}

function inferTitle(text: string): string {
  return text
    .split(/[\n。！？!?]/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 42) ?? "";
}
