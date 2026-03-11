import OpenAI from "openai";

let _client: OpenAI | null = null;
let _available: boolean | null = null;

export function getLLMClient(): OpenAI | null {
  if (_available === false) return null;
  if (_client) return _client;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    _available = false;
    console.warn("[LLM] No OPENAI_API_KEY set. Using rules-only classification.");
    return null;
  }

  _client = new OpenAI({ apiKey });
  _available = true;
  return _client;
}

export function getLLMModel(): string {
  return process.env.OPENAI_MODEL || "gpt-5-mini";
}
