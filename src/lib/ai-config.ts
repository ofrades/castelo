export const AI_MODEL = process.env.AI_MODEL ?? "google/gemini-2.5-flash";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";
export const MIN_WALLET_BALANCE_CENTS = 5;
export const AI_MAX_OUTPUT_TOKENS = 4_000;

function getOpenRouterAttributionHeaders() {
  const referer = process.env.OPENROUTER_HTTP_REFERER;
  const title = process.env.OPENROUTER_APP_TITLE ?? "Castelo";
  return {
    ...(referer ? { "HTTP-Referer": referer } : {}),
    "X-OpenRouter-Title": title,
    "X-OpenRouter-Cache": "true",
  };
}

export function createOpenRouterHeaders() {
  return getOpenRouterAttributionHeaders();
}
