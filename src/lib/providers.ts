/**
 * lib/providers.ts — provider abstraction layer (server + client safe).
 * Every provider implements the same idea: a chat-completions-style
 * call. ONE provider ships working (Gemini, server key). The other
 * seven are OPTIONAL: they read a user-supplied key from Settings
 * (stored in the user's own browser localStorage, never sent anywhere
 * except that provider's API, never persisted or logged server-side).
 * A provider is shown as available ONLY when its key is actually
 * configured. No provider is ever faked as connected.
 *
 * Implementation: /api/providers/route.ts forwards each provider's
 * request — OpenAI-compatible chat completions for OpenAI, DeepSeek,
 * Grok, Qwen and OpenRouter (different base URLs), the Anthropic
 * Messages API for Claude, and the Hugging Face Inference API.
 */

export type ProviderId =
  | "gemini"
  | "openai"
  | "anthropic"
  | "deepseek"
  | "grok"
  | "qwen"
  | "openrouter"
  | "huggingface";

export type ProviderStatus =
  | "ready" // key configured (server env or user key) — calls can be tried
  | "needs-key" // no key anywhere — the user must supply one
  | "unavailable"; // known down / model not supported for this key

export type ProviderKind = "openai" | "anthropic" | "huggingface";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  description: string;
  /** Free-tier limits, stated honestly. Never promise unlimited. */
  freeTier: string;
  keySource: string;
  status: ProviderStatus;
  models: string[];
  kind: ProviderKind;
  /** OpenAI-compatible base URL (kind === "openai" only). */
  baseUrl?: string;
  /** Default model used by the chat + Test button. */
  defaultModel: string;
  /** Settings field (in lib/store) holding the user's key, if any. */
  keyField?: "openaiKey" | "anthropicKey" | "deepseekKey" | "grokKey" | "qwenKey" | "openRouterKey" | "hfKey";
}

/** Model router: picks the model by task.
 * fast = short answers (1024 tokens), auto = balanced (2048),
 * smart = detailed, step-by-step (4096). */
export type TaskMode = "auto" | "fast" | "smart";

export const GEMINI_MODELS = [
  "gemini-3-flash-preview",
  "gemini-flash-lite-latest",
] as const;

/** Models verified NOT to work for this key — never route to them. */
export const GEMINI_DEAD_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-flash-latest",
];

export const PROVIDER_IDS: ProviderId[] = [
  "gemini",
  "openai",
  "anthropic",
  "deepseek",
  "grok",
  "qwen",
  "openrouter",
  "huggingface",
];

export function providerInfos(opts: {
  geminiConfigured: boolean;
  openaiKey: boolean;
  anthropicKey: boolean;
  deepseekKey: boolean;
  grokKey: boolean;
  qwenKey: boolean;
  openRouterKey: boolean;
  huggingFaceKey: boolean;
}): ProviderInfo[] {
  return [
    {
      id: "gemini",
      name: "AfghanGPT Auto",
      description: "Default AI brain — chat, vision, voice, image generation.",
      freeTier:
        "AfghanGPT free tier (limited requests per day/minute; 503 'busy' when overloaded — the app retries with the lite model).",
      keySource: "Server env GEMINI_API_KEY / GEMINIAPIKEY (set by the owner in Vercel).",
      status: opts.geminiConfigured ? "ready" : "needs-key",
      models: [...GEMINI_MODELS],
      kind: "openai",
      defaultModel: "gemini-3-flash-preview",
    },
    {
      id: "openai",
      name: "OpenAI",
      description: "ChatGPT models (GPT-4o mini and others) via the OpenAI API.",
      freeTier:
        "OpenAI has no free tier for the API — a paid account with credits is required. A new account sometimes includes trial credit.",
      keySource: "Your own key, entered in Settings → Providers (stored in localStorage only).",
      status: opts.openaiKey ? "ready" : "needs-key",
      models: ["gpt-4o-mini", "gpt-4o"],
      kind: "openai",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4o-mini",
      keyField: "openaiKey",
    },
    {
      id: "anthropic",
      name: "Anthropic Claude",
      description: "Claude models via the Anthropic Messages API.",
      freeTier:
        "Anthropic has no free API tier — a paid account with credits is required.",
      keySource: "Your own key, entered in Settings → Providers (stored in localStorage only).",
      status: opts.anthropicKey ? "ready" : "needs-key",
      models: ["claude-3-5-haiku-latest", "claude-sonnet-4-20250514"],
      kind: "anthropic",
      defaultModel: "claude-3-5-haiku-latest",
      keyField: "anthropicKey",
    },
    {
      id: "deepseek",
      name: "DeepSeek",
      description: "DeepSeek Chat via its OpenAI-compatible API.",
      freeTier:
        "DeepSeek API is very cheap (pay per token); new accounts sometimes include free credit. No permanent free tier.",
      keySource: "Your own key, entered in Settings → Providers (stored in localStorage only).",
      status: opts.deepseekKey ? "ready" : "needs-key",
      models: ["deepseek-chat", "deepseek-reasoner"],
      kind: "openai",
      baseUrl: "https://api.deepseek.com/v1",
      defaultModel: "deepseek-chat",
      keyField: "deepseekKey",
    },
    {
      id: "grok",
      name: "Grok (xAI)",
      description: "Grok models via the xAI OpenAI-compatible API.",
      freeTier:
        "xAI has no free API tier — a paid account with credits is required.",
      keySource: "Your own key, entered in Settings → Providers (stored in localStorage only).",
      status: opts.grokKey ? "ready" : "needs-key",
      models: ["grok-3-mini", "grok-3"],
      kind: "openai",
      baseUrl: "https://api.x.ai/v1",
      defaultModel: "grok-3-mini",
      keyField: "grokKey",
    },
    {
      id: "qwen",
      name: "Qwen (Alibaba)",
      description: "Qwen models via the DashScope OpenAI-compatible API.",
      freeTier:
        "DashScope offers free trial credit for new accounts; afterwards it is pay per token.",
      keySource: "Your own key, entered in Settings → Providers (stored in localStorage only).",
      status: opts.qwenKey ? "ready" : "needs-key",
      models: ["qwen-plus", "qwen-turbo", "qwen-max"],
      kind: "openai",
      baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      defaultModel: "qwen-plus",
      keyField: "qwenKey",
    },
    {
      id: "openrouter",
      name: "OpenRouter",
      description:
        "Optional: access many models (incl. free ones) through one key. Your key is stored only in your browser.",
      freeTier:
        "Some models on OpenRouter are free (e.g. :free models); most are pay-per-token. Check the model page before use.",
      keySource: "Your own key, entered in Settings → Providers (stored in localStorage only).",
      status: opts.openRouterKey ? "ready" : "needs-key",
      models: ["meta-llama/llama-3.1-8b-instruct:free", "openai/gpt-4o-mini", "meta-llama/llama-3.1-8b-instruct"],
      kind: "openai",
      baseUrl: "https://openrouter.ai/api/v1",
      defaultModel: "meta-llama/llama-3.1-8b-instruct:free",
      keyField: "openRouterKey",
    },
    {
      id: "huggingface",
      name: "Hugging Face",
      description:
        "Optional: free Inference API for open models. Your token is stored only in your browser.",
      freeTier:
        "Free Inference API has rate limits and some models are cold/slow; not every model supports chat.",
      keySource: "Your own token, entered in Settings → Providers (stored in localStorage only).",
      status: opts.huggingFaceKey ? "ready" : "needs-key",
      models: ["HuggingFaceH4/zephyr-7b-beta", "mistralai/Mistral-7B-Instruct-v0.3"],
      kind: "huggingface",
      defaultModel: "HuggingFaceH4/zephyr-7b-beta",
      keyField: "hfKey",
    },
  ];
}

export function providerById(
  id: ProviderId,
  opts: Parameters<typeof providerInfos>[0]
): ProviderInfo {
  return providerInfos(opts).find((p) => p.id === id) ?? providerInfos(opts)[0];
}
