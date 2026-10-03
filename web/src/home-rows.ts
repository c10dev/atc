// HOME(ATC-377)가 그릴 줄을 고르는 순수 함수. 새 규칙은 없다: 알림과 FOLLOW 보드가 이미 센 것에서 한 곳에만 둘 것을 고른다.

// 알림·막힌 FLIGHT 줄을 고르는 규칙은 서버로 갔다: server/supervisor-queue.ts의 actionableAlertsOf·stuckRowsOf(ATC-454)

// 할 일 줄이 한 줄로 말하는 "무엇이 필요한가"(ATC-422). ALERT·STUCK·EFFECT·CLOSE는 서버가 `need`를 준다. 나머지 종류는 서버에 `need`가 없어 종류별 한 문장을 여기서 붙인다(순수, 새 사실 없음)
const NEED_BY_KIND: Record<string, string> = {
  PROPOSAL: "DISPATCH 제안을 승인하거나 거절합니다",
  SCHEDULE: "SCHEDULE 초안을 승인하거나 거절합니다",
  "FLEET PLAN": "FLEET PLAN 제안을 승인하거나 거절합니다",
  "HUMAN CHECK": "PR을 보고 PASS나 FAIL을 남깁니다",
  LANDING: "착륙 허가가 났습니다: 사람이 머지합니다",
  UPDATE: "서비스가 main보다 뒤입니다: 업데이트합니다",
  "NEEDS YOU": "AIRCRAFT가 사람의 답을 기다립니다",
  RELAY: "GO AROUND·FIX를 받을 세션이 없어 손으로 전합니다",
  UNDELIVERED: "닿지 못한 글을 손으로 전합니다",
  GO: "CAPTAIN이 SUPERVISOR의 go를 기다립니다",
  BACKLOG: "atc가 올린 제안을 발권하거나 버립니다",
  ARRIVED: "ARRIVED인데 Linear 이슈가 아직 진행 중입니다: 확인하고 Done으로 옮깁니다",
};
export const homeNeedOf = (i: { kind: string; need?: string }): string => i.need ?? NEED_BY_KIND[i.kind] ?? i.kind;

// ── SCHEDULE을 나눈 뒤 HOME에 남은 것(ATC-378, docs/layout.md Y3) ──
// 서버 `GET /api/schedule/home`의 모양(server/schedule.ts)과 같다. LATE WAYPOINTS는 예외라 있을 때만 그린다
export interface HomeSlip {
  key: string;
  code: "target-passed" | "eta-after-target" | "linear-overdue";
  route: string;
  waypoint: string;
  targetDate: string | null;
  eta: string | null;
  days: number | null;
  reportedAt: string | null;
}
export interface HomeCloseManual {
  id: string;
  flight: string | null;
  status: string;
  statusAt: string;
  title: string | null;
  url: string | null;
  pr: { repo: string; number: number; url: string };
}
export interface ScheduleHome {
  mode: "shadow" | "approval";
  slips: HomeSlip[] | null; // 마일스톤을 못 읽었으면 null
  closeManual: HomeCloseManual[];
}

export const SLIP_LABEL: Record<HomeSlip["code"], string> = { "target-passed": "목표일 지남", "eta-after-target": "ETA 늦음", "linear-overdue": "Linear overdue" };

// 한 줄: `목표 2026-10-05 · ETA 2026-10-09 · 4일`
export const slipLineOf = (x: Pick<HomeSlip, "targetDate" | "eta" | "days">): string =>
  `목표 ${x.targetDate ?? "—"} · ETA ${x.eta ?? "모름"}${x.days != null ? ` · ${x.days}일` : ""}`;

// PR 한 줄: `vocado_nextjs#400`
export const prNameOf = (p: Pick<HomeCloseManual["pr"], "repo" | "number">): string => `${p.repo.split("/").pop()}#${p.number}`;

// 읽은 값 → 그릴 것. 아무것도 그릴 게 없으면 둘 다 빈 목록(정상이면 HOME에 아무것도 없다, design-language 원칙 1)
export const scheduleHomeOf = (d: ScheduleHome | null): { slips: HomeSlip[]; closeManual: HomeCloseManual[] } => ({ slips: d?.slips ?? [], closeManual: d?.closeManual ?? [] });
