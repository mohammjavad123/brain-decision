import { config, EMBEDDING_DIM } from "../config.js";

/**
 * Pluggable embedder. Default 'local' (transformers.js, all-mpnet-base-v2, 768-dim) needs no API key
 * and runs offline after a one-time model download — free, robust retrieval. Swap the model via
 * LOCAL_EMBED_MODEL, or set EMBEDDING_PROVIDER=openai for text-embedding-3-small (1536-dim).
 *
 * Embeddings are how we cluster facts "by embedding proximity, not keywords" and route questions.
 */
export const embeddingDim = EMBEDDING_DIM;

let _extractor: unknown = null;
async function localExtractor(): Promise<(t: string, o: object) => Promise<{ data: Float32Array }>> {
  if (!_extractor) {
    const { pipeline, env } = await import("@xenova/transformers");
    (env as { allowLocalModels: boolean }).allowLocalModels = false;
    _extractor = await pipeline("feature-extraction", config.localEmbedModel);
  }
  return _extractor as (t: string, o: object) => Promise<{ data: Float32Array }>;
}

async function embedLocal(texts: string[]): Promise<number[][]> {
  const extractor = await localExtractor();
  const out: number[][] = [];
  for (const t of texts) {
    const r = await extractor(t, { pooling: "mean", normalize: true });
    out.push(Array.from(r.data));
  }
  return out;
}

async function embedOpenAI(texts: string[]): Promise<number[][]> {
  if (!config.openaiKey) throw new Error("EMBEDDING_PROVIDER=openai but OPENAI_API_KEY is not set.");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.openaiKey}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data.map((d) => d.embedding);
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  return config.embeddingProvider === "openai" ? embedOpenAI(texts) : embedLocal(texts);
}

export async function embedOne(text: string): Promise<number[]> {
  const [v] = await embed([text]);
  if (!v) throw new Error("embedding failed");
  return v;
}

/** Pure cosine similarity — used by deterministic clustering (not the DB ANN path). */
export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
