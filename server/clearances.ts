import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import type { Clearance, ClearanceType } from "./model.ts";

// CLEARANCE 기록. 추가만 하는 JSONL(issue / readback / cancel)을 접어서 현재 상태를 만든다.
const FILE = join(config.stateDir, "clearances.jsonl");
export const CLEARANCE_TYPES: ClearanceType[] = ["TRAFFIC", "HOLD", "CONTINUE", "LAND", "REPORT", "INFO"];

type Op =
  | ({ op: "issue" } & Omit<Clearance, "readbackAt" | "cancelledAt">)
  | { op: "readback" | "cancel"; id: string; at: string };

export function fold(ops: Op[]): Clearance[] {
  const byId = new Map<string, Clearance>();
  for (const o of ops) {
    if (o.op === "issue") {
      const { op: _op, ...rest } = o;
      byId.set(o.id, { ...rest, readbackAt: null, cancelledAt: null });
    } else {
      const c = byId.get(o.id);
      if (!c) continue;
      if (o.op === "readback" && !c.readbackAt) c.readbackAt = o.at;
      if (o.op === "cancel" && !c.cancelledAt) c.cancelledAt = o.at;
    }
  }
  return [...byId.values()];
}

function readOps(file = FILE): Op[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const ops: Op[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      ops.push(JSON.parse(line));
    } catch {}
  }
  return ops;
}

function append(op: Op) {
  mkdirSync(dirname(FILE), { recursive: true });
  appendFileSync(FILE, JSON.stringify(op) + "\n");
}

export function allClearances(): Clearance[] {
  return fold(readOps());
}

export const isPending = (c: Clearance) => !c.readbackAt && !c.cancelledAt;

// 화면용: READBACK 대기 중이거나 최근 24시간 안의 CLEARANCE
export function recentClearances(now = Date.now()): Clearance[] {
  return allClearances().filter((c) => isPending(c) || now - Date.parse(c.at) < 86_400_000);
}

export function issueClearance(input: Omit<Clearance, "id" | "at" | "readbackAt" | "cancelledAt">): Clearance {
  const ops = readOps();
  const n = ops.filter((o) => o.op === "issue").length + 1;
  const issued = { op: "issue" as const, id: `C-${String(n).padStart(4, "0")}`, at: new Date().toISOString(), ...input };
  append(issued);
  return fold([...ops, issued]).find((c) => c.id === issued.id)!;
}

export function markClearance(id: string, op: "readback" | "cancel"): Clearance | null {
  const current = allClearances().find((c) => c.id === id);
  if (!current) return null;
  append({ op, id, at: new Date().toISOString() });
  return allClearances().find((c) => c.id === id)!;
}
