import { runAgent } from "../src/answer/graph.js";
import { getFacts } from "../src/db/queries.js";

/**
 * DEEP test — runs each question MULTIPLE times to measure not just correctness but STABILITY (the
 * prompts must be robust to run-to-run variance). Mirrors the acceptance rubric and adds stricter
 * reasoning checks for the Q3 hero (must flag STALE + surface current UNKNOWN, not just name numbers).
 */
const RUNS = 3;
const has = (t: string, term: string) => term.split("|").some((x) => t.toLowerCase().includes(x.toLowerCase().trim()));

type Check = (d: any, ans: string, srcs: string[]) => { name: string; pass: boolean };
type Test = { id: string; q: string; checks: Check[] };

const conf = (bands: string[]): Check => (d) => ({ name: `conf∈[${bands.join("|")}]`, pass: bands.includes(d.confidence) });
const mention = (m: string): Check => (_d, ans) => ({ name: `says "${m}"`, pass: has(ans, m) });
const citeAny = (grp: string[]): Check => (_d, _a, srcs) => ({ name: `cites[${grp.join("/")}]`, pass: grp.some((s) => srcs.includes(s)) });
const citeAll = (s: string): Check => (_d, _a, srcs) => ({ name: `cites ${s}`, pass: srcs.includes(s) });
const contra: Check = (d) => ({ name: `contradiction`, pass: d.contradiction_ids.length > 0 });
const minCite = (n: number): Check => (d) => ({ name: `≥${n} cites`, pass: d.evidence.length >= n });
const recHas = (m: string): Check => (d) => ({ name: `rec→"${m}"`, pass: has(d.recommendation, m) });

const TESTS: Test[] = [
  {
    id: "Q1 · ICP drift",
    q: "Is our ICP actually mid-market, or are we drifting up?",
    checks: [conf(["medium"]), citeAny(["doc/icp-onepager", "tweet/maya-0612"]), citeAny(["email/northpeak-update-may"]),
             mention("mid-market"), mention("upmarket|enterprise"), mention("drift|drifting|shift"), contra],
  },
  {
    id: "Q2 · objection",
    q: "Which objection is killing deals — and is it real?",
    checks: [conf(["medium", "high"]), citeAny(["call/brightway", "call/acme-eval"]),
             mention("budget"), mention("VP|authority|sign-off|approv"), mention("real|recurring|corroborat")],
  },
  {
    id: "Q3 · runway (HERO)",
    q: "What runway can I defend in this week's investor update?",
    checks: [conf(["medium"]), citeAll("email/northpeak-update-may"), citeAll("note/board-q2"), citeAll("slack/devin-burn"),
             mention("18"), mention("9"), mention("AE|hire"), mention("burn"), contra,
             mention("stale|already old|out of date"), mention("unknown|not known|recalc|recompute|not stated"),
             recHas("burn|current|recalc|updated|figure")],
  },
  {
    id: "Q4 · competitor",
    q: "Which competitor comes up most often across our deals?",
    checks: [conf(["high"]), mention("FreightPilot"), minCite(3)],
  },
];

async function grounded(d: any): Promise<boolean> {
  const ids = d.evidence.map((c: any) => c.fact_id);
  const known = new Set((await getFacts(ids)).map((f) => f.id));
  return ids.every((id: string) => known.has(id));
}

async function main() {
  const filt = process.argv.slice(2); // e.g. "Q1 Q2 Q3" → only those
  const tests = filt.length ? TESTS.filter((t) => filt.some((f) => t.id.toLowerCase().startsWith(f.toLowerCase()))) : TESTS;
  const summary: string[] = [];
  for (const t of tests) {
    console.log(`\n${"═".repeat(70)}\n${t.id}`);
    let fullPass = 0;
    for (let r = 1; r <= RUNS; r++) {
      const { decision: d } = await runAgent(t.q);
      const ans = d.answer;
      const srcs = [...new Set(d.evidence.map((c: any) => c.source_id))];
      const results = t.checks.map((c) => c(d, ans, srcs));
      const g = await grounded(d);
      results.push({ name: "grounded", pass: g });
      const fails = results.filter((x) => !x.pass).map((x) => x.name);
      if (fails.length === 0) fullPass++;
      console.log(`  run${r}: conf=${d.confidence} · ${d.evidence.length} cites · ${fails.length === 0 ? "ALL ✓" : "✗ " + fails.join(", ")}`);
    }
    const line = `${t.id}: ${fullPass}/${RUNS} runs fully passed`;
    summary.push(line);
    console.log(`  → ${line}`);
  }
  console.log(`\n${"═".repeat(70)}\nSTABILITY SUMMARY`);
  for (const s of summary) console.log("  " + s);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
