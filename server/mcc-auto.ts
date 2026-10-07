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

// ── 착륙 경합(ATC-563) ──
// 서버 job이 "살아 있다": 이 서버 프로세스에서 mcc-auto job이 마지막 3분 안에 점검을 시작했다(30초마다 도니 6번). 재시작 직후 첫 점검 전(30초 안)은 살아 있지 않다
export const AUTO_LIVE_MS = 3 * 60_000;
export const autoLiveOf = (lastPassAt: number | null, now: number): boolean => lastPassAt !== null && now - lastPassAt >= 0 && now - lastPassAt <= AUTO_LIVE_MS;

// 서버가 이 PR head에 마지막으로 남긴 land 기록이 거절·실패면 MCC 세션이 넘겨받는다. already-landed·ok는 넘겨받는 것이 아니다
export function serverHandoverOf(records: readonly MccRecord[], pr: number, head: string): boolean {
  const last = records.filter((r) => r.op === "land" && r.by === "server" && r.pr === pr && r.head === head).at(-1);
  return last?.op === "land" && (last.result === "rejected" || last.result === "failed");
}

// MCC 세션의 `mcc land`가 이 PR을 착륙시켜도 되나. 서버가 착륙시킬 PR(autoLandOf와 같은 판정)이고 서버 job이 살아 있고 넘겨받은 head가 아니면 거절한다.
// 스위치 off, 모드 rts, ESCALATE, flagged·user 등급, 막힌 조건은 autoLandOf가 이미 false라 그대로 세션 몫이다
export function sessionLandOf(x: Parameters<typeof autoLandOf>[0] & { live: boolean; handover: boolean }): { refuse: boolean; why: string } {
  if (!autoLandOf(x).land) return { refuse: false, why: "서버가 착륙시키지 않는 PR" };
  if (!x.live) return { refuse: false, why: "서버 mcc-auto job이 3분 넘게 돌지 않음 — 세션이 착륙" };
  if (x.handover) return { refuse: false, why: "서버가 이 head에서 거절·실패 — 세션이 넘겨받음" };
  return { refuse: true, why: "MCC SERVER AUTO on — 이 auto 등급 PR은 서버가 착륙시킨다(서버가 거절·실패하면 이 세션이 넘겨받는다)" };
}

// 머지 결과. already-landed는 다른 쪽(서버 또는 MCC 세션)이 같은 PR을 같은 때 머지한 것: 실패도 오작동도 아니다
export type LandOutcome = { result: "ok" } | { result: "rejected" | "failed" | "already-landed"; detail: string };
// GitHub이 "머지가 이미 진행 중"이라고 답한 405
export const inProgressOf = (stderr: string): boolean => /already in progress/i.test(stderr) && /\b405\b/.test(stderr);
export const stderrOf = (e: unknown): string => {
  const err = e as { stderr?: string; message?: string };
  return err.stderr?.trim() || err.message || String(e);
};
// 정확한 head를 머지한다. 실패하면 405 "already in progress"는 already-landed, 아니면 PR을 다시 읽어 같은 head로 이미 머지됐으면 already-landed,
// 그 밖은 classify(writeResultOf: head가 움직임은 rejected, 나머지 failed) 그대로. 다시 읽지 못하면 classify 그대로
export async function landOutcomeOf(x: {
  head: string;
  merge: () => Promise<unknown>;
  reread: () => Promise<{ merged: boolean; head: string }>;
  classify: (stderr: string) => { result: "rejected" | "failed"; detail: string };
}): Promise<LandOutcome> {
  try {
    await x.merge();
    return { result: "ok" };
  } catch (e) {
    const text = stderrOf(e);
    const r = x.classify(text);
    if (inProgressOf(text)) return { result: "already-landed", detail: r.detail };
    try {
      const p = await x.reread();
      if (p.merged && p.head === x.head) return { result: "already-landed", detail: `${r.detail} — 다시 읽으니 같은 head로 이미 머지됨` };
    } catch {}
    return r;
  }
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
  alreadyLanded: number; // 다른 쪽이 먼저 머지한 착륙 시도(ATC-563). refused·misfires에 넣지 않는다
  rts: number;
  rtsFailed: number;
}
export function autoCountsOf(lines: readonly RecordLine[], now: number, days = 7): AutoCounts {
  const since = now - days * 86_400_000;
  const c: AutoCounts = { lands: 0, rechecks: 0, misfires: 0, refused: 0, alreadyLanded: 0, rts: 0, rtsFailed: 0 };
  for (const l of lines) {
    if (l.kind !== "mcc-auto" || Date.parse(l.t) < since) continue;
    if (l.op === "land") c.lands++;
    else if (l.op === "refused") c.refused++;
    else if (l.op === "already-landed") c.alreadyLanded++;
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
