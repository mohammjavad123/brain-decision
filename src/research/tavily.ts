import { config } from "../config.js";

/** A real web/search tool. Degrades gracefully: no key → no research (the brain says so, honestly). */
export type WebResult = { title: string; url: string; content: string };

export const researchAvailable = (): boolean => !!config.tavilyKey;

export async function tavilySearch(query: string, maxResults = 4): Promise<WebResult[]> {
  if (!config.tavilyKey) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: config.tavilyKey,
        query,
        max_results: maxResults,
        search_depth: "basic",
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
    return (data.results ?? []).map((r) => ({ title: r.title, url: r.url, content: r.content }));
  } catch {
    return [];
  }
}
