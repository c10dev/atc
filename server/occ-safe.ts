// OCC를 지금 STOP·LAUNCH해도 잃는 것이 없나(ATC-169, docs/control-recycle.md 1.3). 순수 함수. 읽기만 한다.
// ATC-166의 재시작 결정이 OCC 줄에서 읽는 입력이다: dispatch brief의 restartSafety. 그쪽이 아직 없으면 이 값은 표시만 한다.

export const SENT_GRACE_MS = 10 * 60_000; // FLIGHT PLAN을 보낸 뒤 READBACK이 올 만한 시간(overdue와 같다)
export const ARRIVAL_GRACE_MS = 30 * 60_000; // PR이 머지된 뒤 CAPTAIN의 최종 보고가 올 만한 시간(following.ts REPORT_GRACE_MS와 같다)
export const WIP_IDLE_MS = 30 * 60_000; // CHARTER REQUEST를 마지막으로 손댄 뒤 아직 다듬는 중으로 보는 시간

export type RestartBlockCode = "approved" | "recalling" | "sent-fresh" | "arrival-fresh" | "wip-active";

export interface RestartBlocker {
  code: RestartBlockCode;
  id: string; // D-xxxx, FLIGHT key, W-xxxx
  text: string;
}

export interface RestartSafety {
  safe: boolean;
  blockers: RestartBlocker[];
}

export interface SafetyInput {
  inFlight: { id: string; status: string; statusAt: string; timeline?: Partial<Record<string, string>> }[];
  arrivalMissing: { flight: string; arrivedAt: string; ageMin: number }[];
  wip: { id: string; touchedAt: string }[];
  now: number;
}

const min = (ms: number) => Math.round(ms / 60_000);

// 조건 넷(ATC-169): inFlight에 approved·recalling이 없고, 보낸 지 10분이 안 된 sent가 없고,
// 머지된 지 30분이 안 된 채 보고가 없는 FLIGHT가 없고, 30분 안에 손댄 CHARTER REQUEST가 없다.
// 이 넷이 없어도 잃는 것이 없는 것은 아니다(CAPTAIN 보고가 아직 오는 중인지는 atc가 모른다). 그래서 "지금 알 수 있는 범위"의 안전이다
export function restartSafetyOf(inp: SafetyInput): RestartSafety {
  const blockers: RestartBlocker[] = [];
  for (const p of inp.inFlight) {
    if (p.status === "approved") blockers.push({ code: "approved", id: p.id, text: `${p.id} 승인됨 — FLIGHT PLAN을 아직 보내지 않았다` });
    else if (p.status === "recalling") blockers.push({ code: "recalling", id: p.id, text: `${p.id} RECALL 중 — READBACK을 기다린다` });
    else if (p.status === "sent") {
      const sentAt = Date.parse(p.timeline?.sent ?? p.statusAt);
      if (inp.now - sentAt < SENT_GRACE_MS) blockers.push({ code: "sent-fresh", id: p.id, text: `${p.id} FLIGHT PLAN을 보낸 지 ${min(inp.now - sentAt)}분 — READBACK이 오는 중일 수 있다` });
    }
  }
  for (const a of inp.arrivalMissing) {
    const age = inp.now - Date.parse(a.arrivedAt);
    if (age < ARRIVAL_GRACE_MS) blockers.push({ code: "arrival-fresh", id: a.flight, text: `${a.flight} PR이 머지된 지 ${min(age)}분 — CAPTAIN의 도착 보고가 오는 중일 수 있다` });
  }
  for (const w of inp.wip) {
    const idle = inp.now - Date.parse(w.touchedAt);
    if (idle < WIP_IDLE_MS) blockers.push({ code: "wip-active", id: w.id, text: `${w.id} CHARTER REQUEST를 ${min(idle)}분 전에 손댐 — 다듬는 중` });
  }
  return { safe: blockers.length === 0, blockers };
}
