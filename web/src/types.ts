export type Confidence = "low" | "medium" | "high";
export type Status = "pending" | "approved" | "rejected";

export type Citation = {
  fact_id: string;
  quote: string;
  source_id: string;
  speaker: string | null;
};

export type ReasoningPoint = { point: string; fact_ids: string[] };

export type Decision = {
  id: string;
  question: string;
  answer: string;
  confidence: Confidence;
  evidence: Citation[];
  reasoning: ReasoningPoint[];
  gaps: string[];
  recommendation: string;
  status: Status;
};

// one streamed graph event (matches the server's streamAgent payload)
export type Step = {
  node: string;
  phase: "active" | "done";
  label: string;
  detail: string[];
  decision: Decision | null;
};

// ── Memory tab: the ingest pipeline streams one event per stage ──
export type IngestFact = {
  id: string;
  type: string;
  value: string;
  quote: string;
  dimension: string | null;
  evidence_tier: string;
  speaker: string | null;
  source_id: string;
};
export type IngestEntity = { id: string; name: string; type: string; aliases: string[] };
export type IngestEdge = { from_id: string; predicate: string; to_id: string };
export type IngestSignal = { type: string; label: string; promotion: string; count: number; companies: string[] };
export type IngestPosition = { name: string; confidence: Confidence; summary: string; gaps: string[] };

export type IngestData = {
  sources?: { id: string; type: string; date: string; participants: string[] }[];
  facts?: IngestFact[];
  entities?: { id?: string; name: string; type: string; aliases?: string[] }[];
  relationships?: { subject: string; predicate: string; object: string }[];
  edges?: IngestEdge[];
  contradictions?: { kind: string; note: string }[];
  signals?: IngestSignal[];
  positions?: IngestPosition[];
  counts?: Record<string, number>;
  rejected?: number;
};

export type IngestStage = "parse" | "extract" | "connect" | "signals" | "positions" | "done" | "error";

export type IngestStep = {
  stage: IngestStage;
  phase: "active" | "done";
  label: string;
  detail: string[];
  data?: IngestData;
};

// ── Database tab: the persisted tables (with provenance trace) ──
export type DbSource = { id: string; type: string; date: string; author: string | null; participants: string[]; body: string };
export type DbFact = {
  id: string; type: string; value: string; quote: string; source_id: string; speaker: string | null;
  dimension: string | null; evidence_tier: string; confidence: number; valid_time: string;
};
export type DbSignal = { id: string; type: string; label: string; promotion: string; count: number; companies: string[]; fact_ids: string[] };
export type DbPosition = { id: string; name: string; summary: string; confidence: Confidence; gaps: string[]; fields: { claim: string; fact_ids: string[] }[] };
export type DbContradiction = { id: string; dimension: string; kind: string; note: string; fact_a: string; fact_b: string };
export type DbDecision = {
  id: string; question: string; answer: string; recommendation: string; confidence: Confidence; status: Status;
  gaps: string[]; evidence: Citation[]; reasoning: ReasoningPoint[]; human_note: string | null; created_at: string; resolved_at: string | null;
};
export type DbEntity = { id: string; name: string; type: string; aliases: string[] };
export type DbEdge = { from_id: string; predicate: string; to_id: string };

export type DbData = {
  counts: Record<string, number>;
  sources: DbSource[];
  facts: DbFact[];
  signals: DbSignal[];
  positions: DbPosition[];
  contradictions: DbContradiction[];
  decisions: DbDecision[];
  entities: DbEntity[];
  edges: DbEdge[];
};
