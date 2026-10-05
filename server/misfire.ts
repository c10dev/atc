import { DEFAULT_SETTLE_MIN } from "./dispatch.ts";
import { AIRCRAFT_WHY, CROSS_ACCOUNT_CLOSED_WHY, STOPPED_WHY, type Proposal } from "./proposals.ts";

// 자동 승인 MISFIRE(ATC-367, docs/autonomy.md 원칙 5: 사람의 클릭이 아니라 늦게 드러나는 결과가 진실). 순수 함수만.
// 서버가 승인한(via "auto") ASSIGN·launch 카드가 나중에 틀렸다고 드러난 경우를 승인한 날 기준으로 센다.
//   declined — CAPTAIN이 거절·UNABLE을 답함
//   recalled — 보낸 뒤 RECALL됨
//   superseded-after-sent — 보낸 뒤 상황이 바뀌어 SUPERSEDED
//   wrong-aircraft — 사유가 "AIRCRAFT 불가"(그 AIRCRAFT가 맞지 않았다고 드러남. 보내기 전이어도 센다)
// 한 카드는 한 가지로만 센다(위 순서의 첫 것, wrong-aircraft가 사유에 있으면 그것).

export const MISFIRE_KINDS = ["declined", "recalled", "superseded-after-sent", "wrong-aircraft"] as const;
export type MisfireKind = (typeof MISFIRE_KINDS)[number];

type Card = Pick<Proposal, "id" | "kind" | "status" | "via" | "reason" | "timeline"> & Partial<Pick<Proposal, "statusAt" | "displacedBy" | "displacedGap" | "flight" | "launch">>;

export const isAutoApproved = (p: Card) => p.kind === "ASSIGN" && p.via === "auto" && Boolean(p.timeline.approved);

export function misfireOf(p: Card): MisfireKind | null {
  if (!isAutoApproved(p)) return null;
  const t = p.timeline;
  if (p.status === "superseded" && (p.reason ?? "").includes(AIRCRAFT_WHY)) return "wrong-aircraft";
  if (p.status === "declined" || t.declined) return "declined";
  if (t.recalling || t.recalled) return "recalled";
  if (p.status === "superseded" && t.sent) return "superseded-after-sent";
  return null;
}

export interface MisfireDay {
  day: string; // 승인한 UTC 날짜
  approvals: number;
  misfires: number;
  share: number | null; // misfires / approvals, 승인이 없으면 null
  by: Record<MisfireKind, number>;
  crossAccount: number; // 그날(닫은 UTC 날짜) ACCOUNT 불일치 규칙으로 닫은 카드 수(ATC-458). 자동 승인 여부와 상관없이 센다
  displaced: number; // 그날(밀려난 UTC 날짜) "더 나은 배정"으로 밀려난 카드 수(ATC-547, 경합 보호가 켜졌을 때만 기록)
  launchStopped: number; // 그날(거둔 UTC 날짜) LAUNCH 직후 "AIRCRAFT 멈춤"으로 거둔 LAUNCH 카드 수(ATC-548, launch-then-stopped). 0이어야 한다
  displacedMisfires: number; // 그중 밀어낸 새 카드가 나중에 SUPERSEDED·EXPIRED로 닫힌 것: 밀어낼 가치가 없었다
}
export interface MisfireView {
  v: 1;
  at: string;
  days: number;
  today: MisfireDay;
  daily: MisfireDay[]; // 오래된 날부터
  total: { approvals: number; misfires: number; share: number | null; crossAccount: number; displaced: number; displacedMisfires: number; launchStopped: number };
}

// ACCOUNT 불일치 규칙(DISPATCH가 OCC에 닿지 않는 AIRCRAFT의 카드를 닫음, ATC-458)으로 닫힌 카드인가. 순수
export const isCrossAccountClosed = (p: Pick<Proposal, "kind" | "status" | "reason">) => p.kind === "ASSIGN" && p.status === "superseded" && (p.reason ?? "").startsWith(CROSS_ACCOUNT_CLOSED_WHY);

// 밀어낸 새 카드가 밀려난 카드의 FLIGHT·AIRCRAFT를 쓰지도 못하고 닫혔나(SUPERSEDED·EXPIRED). 새 카드가 아직 열려 있거나 이어졌으면 아니다. 순수(ATC-547)
export const displacementMisfire = (by: Pick<Card, "status"> | undefined): boolean => by?.status === "superseded" || by?.status === "expired";

// LAUNCH 카드가 LAUNCH(승인) 뒤 한 settle 안에 "AIRCRAFT 멈춤"으로 거둬졌나(ATC-548): 띄운 세션이 뜨자마자 DISPATCH가 그 AIRCRAFT를 못 받는다고 판정했다 — 헛수고였다. 자동 승인 여부와 상관없이 센다. 순수
export const isLaunchStopped = (p: Card, settleMin = DEFAULT_SETTLE_MIN): boolean => {
  if (p.kind !== "ASSIGN" || !p.launch || p.status !== "superseded" || !(p.reason ?? "").startsWith(STOPPED_WHY) || !p.statusAt) return false;
  const launched = Date.parse(p.timeline.approved ?? "");
  return Number.isFinite(launched) && Date.parse(p.statusAt) - launched <= settleMin * 60_000;
};

const emptyBy = (): Record<MisfireKind, number> => ({ declined: 0, recalled: 0, "superseded-after-sent": 0, "wrong-aircraft": 0 });
const DAY = 86_400_000;

export function misfireView(proposals: readonly Card[], now: number, days = 7): MisfireView {
  const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const rows = new Map<string, MisfireDay>();
  for (let i = days - 1; i >= 0; i--) {
    const day = dayOf(now - i * DAY);
    rows.set(day, { day, approvals: 0, misfires: 0, share: null, by: emptyBy(), crossAccount: 0, displaced: 0, displacedMisfires: 0, launchStopped: 0 });
  }
  const byId = new Map(proposals.map((p) => [p.id, p]));
  for (const p of proposals) {
    if (p.kind === "ASSIGN" && p.status === "superseded" && p.displacedBy && p.statusAt) {
      const d = rows.get(p.statusAt.slice(0, 10));
      if (d) {
        d.displaced++;
        if (displacementMisfire(byId.get(p.displacedBy))) d.displacedMisfires++;
      }
    }
    if (isLaunchStopped(p) && p.statusAt) {
      const stopped = rows.get(p.statusAt.slice(0, 10));
      if (stopped) stopped.launchStopped++;
    }
    if (isCrossAccountClosed(p) && p.statusAt) {
      const closed = rows.get(p.statusAt.slice(0, 10));
      if (closed) closed.crossAccount++;
    }
    if (!isAutoApproved(p)) continue;
    const row = rows.get(p.timeline.approved!.slice(0, 10));
    if (!row) continue;
    row.approvals++;
    const m = misfireOf(p);
    if (m) {
      row.misfires++;
      row.by[m]++;
    }
  }
  const daily = [...rows.values()].map((r) => ({ ...r, share: r.approvals ? r.misfires / r.approvals : null }));
  const approvals = daily.reduce((n, r) => n + r.approvals, 0);
  const misfires = daily.reduce((n, r) => n + r.misfires, 0);
  return { v: 1, at: new Date(now).toISOString(), days, today: daily[daily.length - 1], daily, total: { approvals, misfires, share: approvals ? misfires / approvals : null, crossAccount: daily.reduce((n, r) => n + r.crossAccount, 0), displaced: daily.reduce((n, r) => n + r.displaced, 0), displacedMisfires: daily.reduce((n, r) => n + r.displacedMisfires, 0), launchStopped: daily.reduce((n, r) => n + r.launchStopped, 0) } };
}
