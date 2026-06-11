import OpenAI from "openai";
import { z } from "zod";
import { config, requireLLMKey } from "../config.js";

/**
 * The ONE way the LLM is allowed to talk to the system: forced function-call against a Zod schema.
 * "Always low-temperature, strict-schema output — no chain-of-thought in the product path."
 * The model MUST call the tool; we Zod-validate its arguments (with one corrective retry) before
 * anything proceeds. Because every seam emits this structured shape, a deterministic algorithm
 * could replace it later without changing the schema. Provider is swappable — only this file knows it.
 */
let _client: OpenAI | null = null;
function client(): OpenAI {
  // baseURL is undefined for OpenAI (SDK default) and Gemini's OpenAI-compatible endpoint otherwise.
  if (!_client) _client = new OpenAI({ apiKey: requireLLMKey(), baseURL: config.llmBaseUrl });
  return _client;
}

type Msg = { role: "system" | "user"; content: string };

/**
 * Extract the FIRST complete, balanced JSON object from a string — string/escape aware — and ignore
 * anything before or after it. Gemini's json mode occasionally emits a note, a second object, or stray
 * text around the object; naive JSON.parse then throws "non-whitespace after JSON". This cuts cleanly
 * at the first object's matching close brace. Returns null if no balanced object is present (truncated).
 */
export function firstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

export async function structured<T>(opts: {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  toolName: string;
  toolDescription?: string;
  model?: string;
  maxTokens?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high"; // cap Gemini 2.5 "thinking" — the big latency lever
}): Promise<T> {
  const parameters = z.toJSONSchema(opts.schema) as Record<string, unknown>;
  delete parameters.$schema; // bare JSON Schema for the function parameters
  const model = opts.model ?? config.extractModel;

  // Gemini's OpenAI-compatible endpoint is unreliable with FORCED function-calls, so for Gemini we use
  // json_object mode + the schema in the prompt and parse the content; OpenAI keeps forced tool-calls.
  const useJson = config.llmProvider === "gemini";
  const schemaHint = useJson
    ? `\n\nReturn ONLY a single minified JSON object conforming to this JSON Schema — no prose, no markdown fences:\n${JSON.stringify(parameters)}`
    : "";

  const messages: Msg[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user + schemaHint },
  ];

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    // Reasoning models (o-series, gpt-5) reject `temperature` and use `max_completion_tokens`.
    const isReasoning = /^o\d/.test(model) || model.startsWith("gpt-5");
    const params: Record<string, unknown> = { model, messages };
    if (useJson) {
      params.response_format = { type: "json_object" };
    } else {
      params.tools = [
        { type: "function", function: { name: opts.toolName, description: opts.toolDescription ?? "Return the structured result.", parameters } },
      ];
      params.tool_choice = { type: "function", function: { name: opts.toolName } };
    }
    if (isReasoning) {
      params.max_completion_tokens = Math.max(opts.maxTokens ?? 0, 8000); // leave room for reasoning tokens
    } else {
      params.temperature = 0;
      if (useJson) {
        // Gemini 2.5 spends "thinking" tokens against max_tokens. With a bounded thinking budget
        // (reasoning_effort) we use a real output cap — the main latency lever. Without it, keep
        // generous headroom so the JSON output is never truncated.
        if (opts.reasoningEffort) params.reasoning_effort = opts.reasoningEffort;
        params.max_tokens = opts.reasoningEffort ? (opts.maxTokens ?? 2048) : Math.max(opts.maxTokens ?? 0, 8192);
      } else {
        params.max_tokens = opts.maxTokens ?? 4096;
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await client().chat.completions.create(params as any);

    const msg = res.choices[0]?.message;
    const call = msg?.tool_calls?.[0];
    // tool-call args (OpenAI) OR message content (Gemini json_schema); strip ``` fences defensively
    let raw = call && call.type === "function" ? call.function.arguments : (msg?.content ?? null);
    if (raw) {
      raw = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      // keep just the first complete {...} object — robust to a trailing note OR a second object
      const obj = firstJsonObject(raw);
      if (obj) raw = obj;
    }
    if (raw) {
      let json: unknown = null;
      try {
        json = JSON.parse(raw);
      } catch (e) {
        lastErr = e;
      }
      if (json !== null) {
        const parsed = opts.schema.safeParse(json);
        if (parsed.success) return parsed.data;
        lastErr = parsed.error;
        messages.push({
          role: "user",
          content: `Your previous ${opts.toolName} arguments failed schema validation: ${parsed.error.message}. Call ${opts.toolName} again with corrected arguments.`,
        });
        continue;
      }
    }
    lastErr = lastErr ?? new Error("no tool call returned");
    messages.push({ role: "user", content: `You must call ${opts.toolName} with valid JSON arguments.` });
  }
  throw new Error(`structured(${opts.toolName}) failed after retries: ${String(lastErr)}`);
}
