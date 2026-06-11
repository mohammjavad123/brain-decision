import "dotenv/config";

// Provider is swappable. Gemini exposes an OpenAI-COMPATIBLE endpoint, so the same structured()
// tool-calling path works for both — only the base URL, key, and model ids change.
const llmProvider = (process.env.LLM_PROVIDER ?? "openai") as "openai" | "gemini";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai/";
const isG = llmProvider === "gemini";

/** Central config + secrets. No keys are ever hard-coded; everything comes from env (.env). */
export const config = {
  llmProvider,
  llmBaseUrl: isG ? GEMINI_BASE : undefined,
  openaiKey: process.env.OPENAI_API_KEY ?? "",
  geminiKey: process.env.GEMINI_API_KEY ?? "",
  embeddingProvider: (process.env.EMBEDDING_PROVIDER ?? "local") as "local" | "openai",
  localEmbedModel: process.env.LOCAL_EMBED_MODEL ?? "Xenova/all-mpnet-base-v2", // free · local · 768-dim · robust retrieval
  tavilyKey: process.env.TAVILY_API_KEY ?? "",
  extractModel: process.env.EXTRACT_MODEL ?? (isG ? "gemini-2.5-flash" : "gpt-4o"), // write-time: extract typed facts (volume → cheap/fast)
  composeModel: process.env.COMPOSE_MODEL ?? (isG ? "gemini-2.5-pro" : "gpt-4o"), // write-time: compile positions (reasoning → stronger)
  answerModel: process.env.ANSWER_MODEL ?? (isG ? "gemini-2.5-flash" : "gpt-4o"), // answer-time: assess + research (cheap/fast)
  refineModel: process.env.REFINE_MODEL ?? (isG ? "gemini-2.5-flash-lite" : "gpt-4o-mini"), // intake: scope + query rewrite (tiniest/fastest)
  synthesizeModel: process.env.SYNTHESIZE_MODEL ?? (isG ? "gemini-2.5-pro" : "gpt-4o"), // the decision point — Pro for calibration, with bounded thinking (reasoning_effort) for speed; set SYNTHESIZE_MODEL=gemini-2.5-flash to shave more latency
  dataDir: process.env.DATA_DIR ?? "./.data/brain",
  corpusDir: process.env.CORPUS_DIR ?? "./data/corpus",
} as const;

/** Embedding dimensions — must match the active provider/model so the pgvector column lines up. */
const LOCAL_DIMS: Record<string, number> = {
  "Xenova/all-MiniLM-L6-v2": 384,
  "Xenova/bge-small-en-v1.5": 384,
  "Xenova/all-mpnet-base-v2": 768,
  "Xenova/bge-base-en-v1.5": 768,
  "Xenova/gte-base": 768,
};
export const EMBEDDING_DIM =
  config.embeddingProvider === "openai" ? 1536 : (LOCAL_DIMS[config.localEmbedModel] ?? 768);

export function requireLLMKey(): string {
  if (config.llmProvider === "gemini") {
    if (!config.geminiKey) throw new Error("GEMINI_API_KEY is not set (LLM_PROVIDER=gemini).");
    return config.geminiKey;
  }
  if (!config.openaiKey) {
    throw new Error("OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.");
  }
  return config.openaiKey;
}
