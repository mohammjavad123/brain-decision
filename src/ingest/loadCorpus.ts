import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { Source } from "../schema/index.js";
import { config } from "../config.js";
import { sha256, normalizeWs } from "../util.js";

/** Read the markdown corpus → typed Source rows. Raw body is sacred; identity = hash(normalized body). */
function coerceDate(d: unknown): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d);
}

export function loadCorpus(dir = config.corpusDir): Source[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  return files.map((f) => {
    const { data, content } = matter(readFileSync(join(dir, f), "utf8"));
    const body = content.trim();
    return Source.parse({
      id: data.id,
      type: data.type,
      date: coerceDate(data.date),
      author: data.author ?? null,
      participants: data.participants ?? [],
      body,
      hash: sha256(normalizeWs(body).toLowerCase()),
    });
  });
}
