import { runAgent } from "../src/answer/graph.js";
import { getFacts } from "../src/db/queries.js";

/**
 * Acceptance eval — "would Michael sign off?" For each CEO question we encode the GROUND TRUTH the
 * data supports (must-cite sources, must-mention reasoning, expected confidence band, whether a
 * contradiction must surface), run the real agent, and score the answer against it. Failures are
 * printed as WEAKNESSES so we see exactly where it falls short. Needs OPENAI_API_KEY + a seeded DB.
 */
type Test = {
  id: string;
  q: string;
  confidence: string[]; // acceptable confidence band
  citeAll?: string[]; // every one of these source ids must be cited
  citeAnyOf?: string[][]; // for each group, at least one source must be cited
  mention?: string[]; // each must appear in the answer ("a|b" = any of a or b)
  contradiction?: boolean; // a contradiction must be surfaced
  minCitations?: number;
  note: string; // what the correct answer should say (the ground truth)
};

const TESTS: Test[] = [
  {
    id: "Q1 · ICP drift",
    q: "Is our ICP actually mid-market, or are we drifting up?",
    confidence: ["medium"],
    citeAnyOf: [["doc/icp-onepager", "tweet/maya-0612"], ["email/northpeak-update-may"]],
    mention: ["mid-market", "upmarket|enterprise", "drift|drifting|shift"],
    contradiction: true,
    note: "ICP is drifting mid-market → enterprise, but NOT formally redefined; weigh both sides; medium confidence.",
  },
  {
    id: "Q2 · objection",
    q: "Which objection is killing deals — and is it real?",
    confidence: ["medium", "high"],
    citeAnyOf: [["call/brightway", "call/acme-eval"], ["note/priya-pipeline-sync"]],
    mention: ["budget", "VP|authority|sign-off|approv", "real|recurring|corroborat"],
    note: "Budget authority across multiple companies, and it's real; FreightPilot is a competitor, NOT the objection.",
  },
  {
    id: "Q3 · runway (HERO)",
    q: "What runway can I defend in this week's investor update?",
    confidence: ["medium"],
    citeAll: ["email/northpeak-update-may", "note/board-q2", "slack/devin-burn"],
    mention: ["18", "9", "AE|hire", "burn"],
    contradiction: true,
    note: "Reconcile 18mo (current burn, now stale) vs 9mo (conditional on AE hires); flag burn rose after eng hires; medium confidence.",
  },
  {
    id: "Q4 · competitor (high-confidence control)",
    q: "Which competitor comes up most often across our deals?",
    confidence: ["high"],
    mention: ["FreightPilot"],
    minCitations: 3,
    note: "FreightPilot, recurring across ~5 companies, no contradiction → should be HIGH confidence.",
  },
];

const has = (text: string, term: string) =>
  term.split("|").some((t) => text.toLowerCase().includes(t.toLowerCase().trim()));

async function main() {
  let totalChecks = 0;
  let totalPass = 0;
  const weaknesses: string[] = [];

  for (const t of TESTS) {
    console.log(`\n${"═".repeat(72)}\n${t.id}\n  Q: ${t.q}\n  expected: ${t.note}`);
    const { decision } = await runAgent(t.q);
    const ans = decision.answer;
    const srcs = [...new Set(decision.evidence.map((c) => c.source_id))];

    console.log(`  → confidence: ${decision.confidence} · ${decision.evidence.length} citations`);
    console.log(`  → answer: ${ans.slice(0, 220).replace(/\s+/g, " ")}…`);
    console.log(`  → cited sources: ${srcs.join(", ")}`);

    const checks: { name: string; pass: boolean }[] = [];

    checks.push({ name: `confidence ∈ [${t.confidence.join("|")}]`, pass: t.confidence.includes(decision.confidence) });

    if (t.citeAll) for (const s of t.citeAll) checks.push({ name: `cites ${s}`, pass: srcs.includes(s) });
    if (t.citeAnyOf)
      for (const grp of t.citeAnyOf) checks.push({ name: `cites one of [${grp.join(", ")}]`, pass: grp.some((s) => srcs.includes(s)) });
    if (t.mention) for (const m of t.mention) checks.push({ name: `mentions "${m}"`, pass: has(ans, m) });
    if (t.contradiction) checks.push({ name: `surfaces a contradiction`, pass: decision.contradiction_ids.length > 0 });
    if (t.minCitations) checks.push({ name: `≥${t.minCitations} citations`, pass: decision.evidence.length >= t.minCitations });

    // grounding: every cited fact must resolve to a real fact (no hallucinated citations)
    const ids = decision.evidence.map((c) => c.fact_id);
    const known = new Set((await getFacts(ids)).map((f) => f.id));
    checks.push({ name: `all citations grounded`, pass: ids.every((id) => known.has(id)) });

    for (const c of checks) {
      totalChecks++;
      if (c.pass) totalPass++;
      else weaknesses.push(`${t.id}: ${c.name}`);
      console.log(`     ${c.pass ? "✓" : "✗"} ${c.name}`);
    }
    const passed = checks.filter((c) => c.pass).length;
    console.log(`  ── ${passed}/${checks.length} ${passed === checks.length ? "PASS" : "⚠ see weaknesses"}`);
  }

  console.log(`\n${"═".repeat(72)}\nSCORE: ${totalPass}/${totalChecks} checks passed`);
  if (weaknesses.length) {
    console.log(`\nWEAKNESSES (${weaknesses.length}):`);
    for (const w of weaknesses) console.log(`  ✗ ${w}`);
  } else {
    console.log(`\n✓ no weaknesses — all checks passed`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
