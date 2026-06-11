/**
 * The ONE canonical dimension classifier. Used BOTH at ingest (to tag a fact's dimension) and at
 * loop-closure (to tag a folded-back decision), so a decision lands on the *same* dimension bucket as
 * the facts that produced it — otherwise the "next related question retrieves it" promise misses on
 * dimension-complete fetch. Deterministic; `llm` is an optional fallback (the extractor's own guess).
 */
export function canonicalDimension(text: string, llm: string | null = null): string | null {
  const t = text.toLowerCase();
  // explicit ICP references win first — so "not our ICP: enterprise" stays ICP, not budget
  if (/\bicp\b|ideal customer|not our icp|target (market|customer|segment)/.test(t)) return "icp";
  if (/\brunway\b|\bburn\b|months? of (cash|runway)|cash (left|out|runway)|\braise\b|fundrais/.test(t)) return "runway";
  if (/\bbudget\b|sign-?off|approv|procurement|spend authority|purchase order|authority/.test(t)) return "budget_authority";
  if (/mid-?market|enterprise|upmarket|self-?serve|moving up/.test(t)) return "icp";
  if (/freightpilot|losing to|\bcompete\b|competitor/.test(t)) return "competitor";
  return llm;
}
