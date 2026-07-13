import { generateSmartAlbums } from "../packages/action-card-service/src/index";
import {
  createAiProvider,
  createMockAiProvider,
  getAiConfigFromEnv,
  type AiRuntimeStatus,
  type GenerateSmartAlbumsInput,
  type RegenerateActionCardOptions
} from "../packages/ai-service/src/index";
import { isAiTask, type AiProxyResponse, type AiResponseMeta } from "../packages/ai-service/src/schemas";
import type { ImportBatch, ShareInput } from "../packages/shared-types/src/index";

declare const process: { env: Record<string, string | undefined> };

type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => {
    json: (body: unknown) => void;
  };
  setHeader?: (name: string, value: string) => void;
};

type AiRequestBody = {
  task?: unknown;
  payload?: unknown;
};

const MAX_PAYLOAD_BYTES = 80_000;

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  res.setHeader?.("content-type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return send(res, 405, {
      ok: false,
      error: { code: "AI_METHOD_NOT_ALLOWED", message: "Only POST is supported for /api/ai." }
    });
  }

  const body = parseBody(req.body);
  const bodySize = JSON.stringify(body).length;
  if (bodySize > MAX_PAYLOAD_BYTES) {
    return send(res, 413, {
      ok: false,
      error: { code: "AI_PAYLOAD_TOO_LARGE", message: "AI request payload is too large. Try importing fewer items at once." }
    });
  }

  if (!isAiTask(body.task)) {
    return send(res, 400, {
      ok: false,
      error: { code: "AI_BAD_REQUEST", message: "Unsupported or missing AI task." }
    });
  }

  const config = getAiConfigFromEnv(process.env as Record<string, unknown>);
  const providerMode = (config.provider || "mock").toLowerCase();
  const wantsRealProvider = providerMode === "openai-compatible" || providerMode === "real";
  const baseMeta = metaFromConfig(config, wantsRealProvider);

  if (wantsRealProvider && !config.apiKey) {
    const provider = createMockAiProvider({ generateSmartAlbums });
    const data = await executeTask(provider, body.task, body.payload);
    return send(res, 200, {
      ok: true,
      data,
      meta: {
        provider: "mock",
        providerName: "MockAIProvider",
        model: "local-rules",
        fallback: true,
        reason: "AI_KEY_MISSING",
        apiKeyConfigured: false
      }
    });
  }

  const provider = createAiProvider(config, createMockAiProvider({ generateSmartAlbums }));

  try {
    const data = await executeTask(provider, body.task, body.payload);
    const status = provider.getStatus();
    return send(res, 200, {
      ok: true,
      data,
      meta: metaFromStatus(status)
    });
  } catch {
    return send(res, 500, {
      ok: false,
      error: { code: "AI_INTERNAL_ERROR", message: "AI request failed and was not completed." },
      meta: { ...baseMeta, fallback: true, reason: "AI_API_ERROR" }
    });
  }
}

async function executeTask(provider: ReturnType<typeof createAiProvider>, task: NonNullable<AiRequestBody["task"]>, payload: unknown): Promise<unknown> {
  switch (task) {
    case "classify_action_card":
      return provider.classifyAndGenerateActionCard(normalizeShareInput(payload));
    case "generate_smart_albums":
      return provider.generateSmartAlbums(normalizeSmartAlbumInput(payload));
    case "regenerate_action_card": {
      const record = isRecord(payload) ? payload : {};
      return provider.regenerateActionCard(
        typeof record.savedItemId === "string" ? record.savedItemId : "",
        record as RegenerateActionCardOptions
      );
    }
    case "summarize_import_batch":
      return provider.summarizeImportBatch(payload as ImportBatch);
    case "generate_search_keywords":
      return provider.generateSearchKeywords(normalizeShareInput(payload));
    default:
      throw new Error("Unsupported AI task");
  }
}

function parseBody(body: unknown): AiRequestBody {
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as AiRequestBody;
    } catch {
      return {};
    }
  }
  return isRecord(body) ? body : {};
}

function normalizeShareInput(value: unknown): ShareInput {
  const record = isRecord(value) ? value : {};
  return {
    sourceUrl: readString(record.sourceUrl),
    title: readString(record.title),
    rawShareText: readString(record.rawShareText),
    userNote: readString(record.userNote)
  };
}

function normalizeSmartAlbumInput(value: unknown): GenerateSmartAlbumsInput {
  const record = isRecord(value) ? value : {};
  return {
    savedItems: Array.isArray(record.savedItems) ? record.savedItems as GenerateSmartAlbumsInput["savedItems"] : [],
    existingAlbums: Array.isArray(record.existingAlbums) ? record.existingAlbums as GenerateSmartAlbumsInput["existingAlbums"] : [],
    now: typeof record.now === "string" ? new Date(record.now) : new Date()
  };
}

function metaFromConfig(config: ReturnType<typeof getAiConfigFromEnv>, realMode: boolean): AiResponseMeta {
  return {
    provider: realMode ? "real" : "mock",
    providerName: realMode ? "OpenAICompatibleProvider" : "MockAIProvider",
    model: realMode ? config.model || "gpt-4.1-mini" : "local-rules",
    fallback: !realMode || !config.apiKey,
    apiKeyConfigured: Boolean(config.apiKey)
  };
}

function metaFromStatus(status: AiRuntimeStatus): AiResponseMeta {
  return {
    provider: status.mode === "real" ? "real" : "mock",
    providerName: status.providerName,
    model: status.modelName,
    fallback: status.fallbackActive || status.lastCallStatus === "fallback" || status.lastCallStatus === "blocked",
    reason: status.lastError,
    apiKeyConfigured: status.apiKeyConfigured
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function send<T>(res: ApiResponse, status: number, body: AiProxyResponse<T>): void {
  res.status(status).json(body);
}
