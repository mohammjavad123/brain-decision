import { createHash, randomUUID } from "node:crypto";

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
export const newId = (prefix: string): string => `${prefix}_${randomUUID().slice(0, 8)}`;
export const nowIso = (): string => new Date().toISOString();
export const normalizeWs = (s: string): string => s.replace(/\s+/g, " ").trim();
