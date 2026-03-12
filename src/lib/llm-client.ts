import OpenAI from "openai";

let _client: OpenAI | null = null;
let _available: boolean | null = null;

export function getLLMClient(): OpenAI | null {
  if (_available === false) return null;
  if (_client) return _client;

  // Try Google Gemini first, then OpenAI
  const geminiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (geminiKey) {
    _client = new OpenAI({
      apiKey: geminiKey,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    });
    _available = true;
    return _client;
  }

  if (openaiKey) {
    _client = new OpenAI({ apiKey: openaiKey });
    _available = true;
    return _client;
  }

  _available = false;
  console.warn("[LLM] No API key set (GOOGLE_AI_API_KEY or OPENAI_API_KEY). Using rules-only classification.");
  return null;
}

export function getLLMModel(): string {
  return process.env.LLM_MODEL || process.env.OPENAI_MODEL || "gemini-2.5-flash";
}
