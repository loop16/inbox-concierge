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

const _isGemini = !!(process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY);

// Fast model for bulk classification
export function getLLMModel(): string {
  if (process.env.LLM_MODEL) return process.env.LLM_MODEL;
  if (!_isGemini && process.env.OPENAI_MODEL) return process.env.OPENAI_MODEL;
  return _isGemini ? "gemini-2.5-flash-lite" : "gpt-4o-mini";
}

// Fallback models to try if the primary fast model 404s
export function getLLMModelFallbacks(): string[] {
  if (!_isGemini) return [];
  return ["gemini-2.0-flash-001", "gemini-2.0-flash"];
}

// Smart model for reasoning tasks (bucket suggestions, summarize, pattern discovery)
export function getSmartModel(): string {
  if (process.env.LLM_SMART_MODEL) return process.env.LLM_SMART_MODEL;
  return _isGemini ? "gemini-2.5-flash" : "gpt-4o";
}
