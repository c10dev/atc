import type { CiState, MccMode, MccRecord } from "./mcc.ts";
import type { RecordLine } from "./recorder.ts";

// 서버의 기계적 착륙·RTS 판단(ATC-556, docs/mcc.md "Server auto"). 순수 함수만(입출력은 mcc-run.ts, update-run.ts).
// 서버가 맡는 것은 auto 등급 PR의 LAND와 그 RTS뿐이다. flagged·user 등급과 ESCALATE·HOLD·GROUND STOP·CI 같은 착륙 조건(L2–L8)은 MCC 세션이 하던 것과 같은 landBlocksOf가 본다.

export type ServerAuto = "on" | "off";

// 이 PR을 서버가 착륙시켜도 되나. blocks는 landBlocksOf가 지금 GitHub 자료로 낸 막힌 조건의 수
export function autoLandOf(x: { mode: MccMode; serverAuto: ServerAuto; tier: "auto" | "flagged" | "user"; blocks: number; escalated: boolean }): { land: boolean; why: string } {
  if (x.serverAuto !== "on") return { land: false, why: "스위치 off — MCC 세션이 착륙" };
  // rts 모드는 SUPERVISOR가 손으로 머지하겠다고 고른 것이다: 서버가 대신 머지하지 않는다
  if (x.mode === "rts") return { land: false, why: "모드 rts: 착륙은 사용자" };
  if (x.escalated) return { land: false, why: "ESCALATE됨 — 사용자" };
  if (x.tier !== "auto") return { land: false, why: `${x.tier} 등급 — 서버는 auto 등급만 착륙시킨다` };
  if (x.blocks > 0) return { land: false, why: `막힌 조건 ${x.blocks}` };
  return { land: true, why: "auto 등급, 착륙 조건 모두 맞음" };
}

// 서버가 착륙시킨 PR 번호(mcc.jsonl의 land ok, by server)
export const serverLandedOf = (records: readonly MccRecord[]): Set<number> => {
  const out = new Set<number>();
  for (const r of records) if (r.op === "land" && r.result === "ok" && r.by === "server") out.add(r.pr);
  return out;
};

// deployed..main 범위의 PR이 하나 이상이고 모두 서버가 착륙시킨 것이면 서버 자동 RTS를 해도 된다.
// 범위를 못 읽었거나(null) 사람이 머지한 PR이 섞였으면 아니다: 그 배포는 모드 rts·land+rts를 고른 SUPERVISOR나 UPDATE 바의 일이다
export function rtsViaAutoOf(serverAuto: ServerAuto, rangePrs: readonly number[] | null, landed: ReadonlySet<number>): boolean {
  if (serverAuto !== "on" || !rangePrs || rangePrs.length === 0) return false;
  return rangePrs.every((n) => landed.has(n));
}

// 착륙 뒤 다시 읽은 PR이 지금이라면 착륙을 막았을 조건(오작동). 빈 목록이면 맞게 착륙한 것이다
export function recheckOf(x: { ci: CiState; ciCheck: string; inspection: "pass" | "findings" | null; escalatedAfter: boolean; held: boolean }): string[] {
  const out: string[] = [];
  if (x.ci === "failed") out.push(`CI ${x.ciCheck} 실패`);
  else if (x.ci === "none") out.push(`CI ${x.ciCheck} 없음`);
  if (x.inspection === "findings") out.push("INSPECTION findings");
  if (x.escalatedAfter) out.push("착륙 뒤 ESCALATE");
  if (x.held) out.push("SUPERVISOR HOLD");
  return out;
}
export const RECHECK_AFTER_MS = 3 * 60_000;
export const RECHECK_WITHIN_MS = 24 * 3_600_000;

// 다시 읽을 때가 된 서버 착륙: 3분 뒤부터 24시간 안, 아직 recheck 줄이 없는 것
export function recheckDueOf(records: readonly MccRecord[], lines: readonly RecordLine[], now: number): { pr: number; head: string; at: string }[] {
  const done = new Set<string>();
  for (const l of lines) if (l.kind === "mcc-auto" && l.op === "recheck") done.add(`${l.pr}@${l.head}`);
  const out: { pr: number; head: string; at: string }[] = [];
  for (const r of records) {
    if (r.op !== "land" || r.result !== "ok" || r.by !== "server") continue;
    const age = now - Date.parse(r.at);
    if (age < RECHECK_AFTER_MS || age > RECHECK_WITHIN_MS || done.has(`${r.pr}@${r.head}`)) continue;
    out.push({ pr: r.pr, head: r.head, at: r.at });
  }
  return out;
}

// SUPERVISOR 화면의 숫자(최근 days일). 0도 보여서 "한 번도 안 울렸다"와 구분한다
export interface AutoCounts {
  lands: number;
  rechecks: number;
  misfires: number;
  refused: number;
  rts: number;
  rtsFailed: number;
}
export function autoCountsOf(lines: readonly RecordLine[], now: number, days = 7): AutoCounts {
  const since = now - days * 86_400_000;
  const c: AutoCounts = { lands: 0, rechecks: 0, misfires: 0, refused: 0, rts: 0, rtsFailed: 0 };
  for (const l of lines) {
    if (l.kind !== "mcc-auto" || Date.parse(l.t) < since) continue;
    if (l.op === "land") c.lands++;
    else if (l.op === "refused") c.refused++;
    else if (l.op === "recheck") {
      c.rechecks++;
      if (l.misfire.length) c.misfires++;
    } else if (l.op === "rts") {
      if (l.result === "started") c.rts++;
      else c.rtsFailed++;
    }
  }
  return c;
}
// 화면과 MCC queue가 보이는 최근 줄(최대 n, 새것 먼저)
export function autoRecentOf(lines: readonly RecordLine[], n = 5): RecordLine[] {
  return lines.filter((l) => l.kind === "mcc-auto").slice(-n).reverse();
}
