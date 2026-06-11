import matter from "gray-matter";
import { Source } from "../schema/index.js";
import { sha256, normalizeWs } from "../util.js";

/**
 * Parse ONE pasted item (the same `--- frontmatter ---` + body format as the corpus files) into a
 * typed Source. Used by the Memory tab so a human can paste a raw item and watch it become memory.
 * Identity = hash(normalized body), exactly like loadCorpus — so re-pasting the same body is a no-op.
 */
function coerceDate(d: unknown): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d ?? "");
}

/**
 * Split a paste that may contain MANY items into typed Sources. Each item starts with its own
 * `--- id: … type: … ---` frontmatter block; the body runs until the next item's frontmatter. A `---`
 * fence inside a body is ignored unless its block declares an `id:`, so transcript dividers are safe.
 * One item → one Source; the result is always validated per item (each must have id + type).
 */
export function parseSources(text: string): Source[] {
  const t = text.trim();
  if (!t) throw new Error("nothing to ingest — paste at least one item with a `--- id/type ---` header");

  // locate the START of every frontmatter block whose contents declare an `id:` (= a real item header)
  const fence = /(?:^|\n)(---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$))/g;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = fence.exec(t)) !== null) {
    if (/(^|\n)\s*id\s*:/.test(m[2]!)) starts.push(m.index + (m[0].startsWith("\n") ? 1 : 0));
  }
  if (starts.length === 0) throw new Error("no item header found — each item needs a `--- id: … type: … ---` block");

  const sources: Source[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < starts.length; i++) {
    const chunk = t.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : t.length).trim();
    const s = parseSourceText(chunk);
    if (seen.has(s.id)) throw new Error(`duplicate id "${s.id}" in the paste — each item needs a unique id`);
    seen.add(s.id);
    sources.push(s);
  }
  return sources;
}

export function parseSourceText(text: string): Source {
  const { data, content } = matter(text);
  const body = content.trim();
  if (!body) throw new Error("empty body — paste the transcript/email/note under the frontmatter");
  if (!data.id) throw new Error("missing `id` in frontmatter (e.g. id: call/acme-eval)");
  if (!data.type) throw new Error("missing `type` in frontmatter (call | email | note | slack | doc | tweet)");

  return Source.parse({
    id: String(data.id),
    type: data.type,
    date: data.date ? coerceDate(data.date) : new Date().toISOString().slice(0, 10),
    author: data.author ?? null,
    participants: data.participants ?? [],
    body,
    hash: sha256(normalizeWs(body).toLowerCase()),
  });
}
