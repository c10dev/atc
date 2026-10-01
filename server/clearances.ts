import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import type { Clearance, ClearanceType } from "./model.ts";
import { type Answer, answerError, overdueBase, responseOf } from "./response.ts";

// CLEARANCE 기록. 추가만 하는 JSONL(issue / readback / roger / unable / standby / cancel)을 접어서 현재 상태를 만든다.
// roger·unable·standby는 ATC-122. 옛 서버는 모르는 op를 건너뛴다(되돌려도 기록이 깨지지 않는다)
const FILE = join(config.stateDir, "clearances.jsonl");
export const CLEARANCE_TYPES: ClearanceType[] = ["TRAFFIC", "HOLD", "CONTINUE", "LAND", "GO AROUND", "FIX", "REPORT", "INFO"];

type Base = Omit<Clearance, "readbackAt" | "cancelledAt" | "ackWord" | "unableAt" | "unableReason" | "standbyAt" | "standbys">;
export type ClearanceOp =
  | ({ op: "issue" } & Base)
  | { op: "readback" | "roger" | "standby" | "cancel"; id: string; at: string }
  | { op: "unable"; id: string; at: string; reason: string };
export type ClearanceAnswerOp = "readback" | "roger" | "unable" | "standby" | "cancel";

// 닫힌 CLEARANCE(READBACK·ROGER·UNABLE·취소)에는 더 답하지 않는다. 먼저 온 닫힘만 남는다.
// 취소는 전처럼 READBACK 뒤에도 된다(LAND를 거둘 때, ATFM이 cancelledAt을 읽는다)
const isClosed = (c: Clearance) => Boolean(c.readbackAt || c.unableAt || c.cancelledAt);

export function fold(ops: ClearanceOp[]): Clearance[] {
  const byId = new Map<string, Clearance>();
  for (const o of ops) {
    if (o.op === "issue") {
      const { op: _op, ...rest } = o;
      byId.set(o.id, { ...rest, readbackAt: null, cancelledAt: null });
      continue;
    }
    const c = byId.get(o.id);
    if (!c) continue;
    if (o.op === "cancel") {
      c.cancelledAt ??= o.at;
      continue;
    }
    if (isClosed(c)) continue;
    if (o.op === "readback" || o.op === "roger") {
      c.readbackAt = o.at;
      c.ackWord = o.op === "roger" ? "ROGER" : "READBACK";
    } else if (o.op === "unable") {
      c.unableAt = o.at;
      c.unableReason = o.reason;
    } else if (o.op === "standby") {
      c.standbyAt ??= o.at;
      c.standbys = (c.standbys ?? 0) + 1;
    }
  }
  return [...byId.values()];
}

export function readOps(file = FILE): ClearanceOp[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const ops: ClearanceOp[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      ops.push(JSON.parse(line));
    } catch {}
  }
  return ops;
}

function append(op: ClearanceOp) {
  mkdirSync(dirname(FILE), { recursive: true });
  appendFileSync(FILE, JSON.stringify(op) + "\n");
}

export function allClearances(): Clearance[] {
  return fold(readOps());
}

export const isPending = (c: Clearance) => !c.readbackAt && !c.unableAt && !c.cancelledAt;

// READBACK overdue: 답이 없는 채 보낸 뒤(첫 STANDBY가 있으면 그 뒤) ms가 지났나
export const isClearanceOverdue = (c: Clearance, now: number, ms: number) => isPending(c) && now - overdueBase(c.at, c.standbyAt) > ms;

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

const ANSWER: Record<Exclude<ClearanceAnswerOp, "cancel">, Answer> = { readback: "READBACK", roger: "ROGER", unable: "UNABLE", standby: "STANDBY" };

// 이 CLEARANCE에 이 답을 기록할 수 있나(순수). 안 되면 사유.
// 이미 READBACK·ROGER로 닫힌 것에 다시 온 READBACK·ROGER는 그대로 받는다(전처럼, 기록은 더하지 않는다)
export function clearanceAnswerError(c: Clearance, op: ClearanceAnswerOp): string | null {
  if (op === "cancel") return null;
  if ((op === "readback" || op === "roger") && c.readbackAt && !c.unableAt && !c.cancelledAt) return null;
  if (c.readbackAt || c.unableAt || c.cancelledAt) {
    const how = c.cancelledAt ? "취소됨" : c.unableAt ? "UNABLE로 닫힘" : c.ackWord === "ROGER" ? "ROGER로 닫힘" : "READBACK으로 닫힘";
    return `${c.id}는 이미 ${how}`;
  }
  return answerError("clearance", responseOf("clearance", c.type), ANSWER[op]);
}

export function markClearance(id: string, op: ClearanceAnswerOp, reason?: string): Clearance | { error: string } | null {
  const current = allClearances().find((c) => c.id === id);
  if (!current) return null;
  const error = clearanceAnswerError(current, op);
  if (error) return { error };
  if (op === "unable") {
    if (!reason?.trim()) return { error: "UNABLE에는 CAPTAIN의 사유가 필요함" };
    append({ op, id, at: new Date().toISOString(), reason: reason.trim() });
  } else if (!((op === "readback" || op === "roger") && current.readbackAt)) {
    append({ op, id, at: new Date().toISOString() });
  }
  return allClearances().find((c) => c.id === id)!;
}
