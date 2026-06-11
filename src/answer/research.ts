import { tavilySearch, researchAvailable } from "../research/tavily.js";
import { structured } from "../llm/structured.js";
import { ResearchExtraction } from "../schema/index.js";
import type { Fact } from "../schema/index.js";
import { insertSource, insertFact } from "../db/queries.js";
import { embed } from "../llm/embed.js";
import { newId, nowIso, sha256, normalizeWs } from "../util.js";
import { config } from "../config.js";

/**
 * Gap-fill research. Fires ONLY when a position carries an open gap. Searches the web, then an LLM
 * EVALUATES the results and folds the relevant bits back as cited facts (source = the web page) —
 * "not a raw web dump." Those facts enter memory through the same path as everything else.
 */
export type ResearchOutcome = { available: boolean; facts: Fact[]; query: string };

const SYSTEM = `You evaluate web search results to fill ONE specific gap for a founder's decision.
Extract only findings that DIRECTLY address the gap, as cited facts. Each finding needs a "quote"
copied verbatim from the provided result content. Ignore marketing fluff and anything off-topic.
This is evaluation, not a dump — prefer 1–4 high-relevance findings over many weak ones.`;

export async function researchGap(
  gap: string,
  dimension: string | null,
  opts: { log?: (m: string) => void } = {},
): Promise<ResearchOutcome> {
  const log = opts.log ?? (() => {});
  if (!researchAvailable()) return { available: false, facts: [], query: gap };

  const results = await tavilySearch(gap, 4);
  if (results.length === 0) return { available: true, facts: [], query: gap };

  const now = nowIso();
  const corpus = results.map((r, i) => `[${i}] ${r.title} (${r.url})\n${r.content}`).join("\n\n");
  const ext = await structured({
    system: SYSTEM,
    user: `GAP TO FILL: ${gap}\n\nWEB RESULTS:\n${corpus}`,
    schema: ResearchExtraction,
    toolName: "record_findings",
    toolDescription: "Record only findings that directly fill the gap, each with a verbatim quote.",
    model: config.answerModel, // answer-time → fast model
    maxTokens: 2048,
    reasoningEffort: "low",
  });

  const facts: Fact[] = [];
  for (const finding of ext.findings) {
    const host =
      results.find((r) => normalizeWs(r.content).includes(normalizeWs(finding.quote))) ?? results[0]!;
    const srcId = `web/${sha256(host.url).slice(0, 10)}`;
    await insertSource({
      id: srcId,
      type: "doc",
      date: now.slice(0, 10),
      author: host.url, // provenance: the URL
      participants: [],
      body: host.content,
      hash: sha256(normalizeWs(host.content).toLowerCase()),
    });
    const loc = host.content.indexOf(finding.quote);
    facts.push({
      id: newId("fact"),
      type: "claim",
      value: finding.claim,
      quote: finding.quote,
      source_id: srcId,
      speaker: null,
      location_start: loc >= 0 ? loc : null,
      location_end: loc >= 0 ? loc + finding.quote.length : null,
      confidence: finding.relevance,
      evidence_tier: "E2", // external web research — kept low so it never reads as first-party signal
      dimension,
      qualifier: null,
      comparable: null,
      valid_time: now,
      learned_time: now,
      superseded_at: null,
    });
  }

  if (facts.length > 0) {
    const vecs = await embed(facts.map((f) => `${f.dimension ?? ""} ${f.value}`.trim()));
    for (let i = 0; i < facts.length; i++) await insertFact(facts[i]!, vecs[i]!);
  }
  log(`    ⌕ researched "${gap}" → ${facts.length} cited fact(s)`);
  return { available: true, facts, query: gap };
}
