export type Confidence = "low" | "medium" | "high";
export type Status = "pending" | "approved" | "rejected";

export type Citation = {
  fact_id: string;
  quote: string;
  source_id: string;
  speaker: string | null;
};

export type Decision = {
  id: string;
  question: string;
  answer: string;
  confidence: Confidence;
  evidence: Citation[];
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
