// METRICS → MISFIRE(ATC-380, docs/layout.md Y5)가 그릴 줄을 만드는 순수 함수. 새 규칙은 없다: 서버가 이미 센 값(DISPATCH 승인·misfire,
// `/api/autonomy/auto`의 SCHEDULE·FLEET PLAN 적용·misfire)을 레인마다 한 줄로 나란히 놓을 뿐이다.

export interface DispatchMisfire {
  total: { approvals: number; misfires: number; share: number | null; crossAccount?: number }; // crossAccount: ACCOUNT 불일치 규칙으로 닫은 카드(ATC-458)
}
export interface AutoMisfireLine {
  at: string;
  kind: "schedule" | "fleet";
  id: string;
  why: "undone" | "stop-launch" | "idle-launch" | "restart-loop";
  what: string;
  flight?: string | null;
  aircraft?: string;
  detail?: string;
}
export interface AutoView {
  switches: { schedule: string; fleetPlan: string };
  misfires: { day: string; schedule: number; fleet: number }[];
  applied: { schedule: number; fleet: number; fleetFailed: number };
  recent: AutoMisfireLine[];
}

// `/api/landing-gap`(ATC-501): HOME 착륙 간격 규칙의 에피소드와 스스로 풀린 막힘(MISFIRE) 수
export interface GapView {
  switch: string;
  episodes: number;
  closed: number;
  misfires: number;
  share: number | null;
}

export type LaneName = "DISPATCH" | "SCHEDULE" | "FLEET PLAN" | "LANDING GAP";
export interface LaneRow {
  lane: LaneName;
  switch: string | null; // on·off, DISPATCH는 서버의 자동 운항 스위치가 따로라 모른다
  applied: number; // 서버가 사람 없이 한 일(승인·적용)
  misfires: number; // 그중 나중에 틀렸다고 드러난 것
  share: number | null; // misfires / applied, 한 일이 없으면 null
  failed: number; // FLEET PLAN: 적용하려다 실패한 수(misfire와 다른 사건)
}

const share = (m: number, a: number) => (a > 0 ? m / a : null);

// 레인마다 한 줄. 읽지 못한 레인은 줄을 내지 않는다(0으로 지어내지 않는다)
export function laneRowsOf(dispatch: DispatchMisfire | null, auto: AutoView | null, gap: GapView | null = null): LaneRow[] {
  const out: LaneRow[] = [];
  if (dispatch) out.push({ lane: "DISPATCH", switch: null, applied: dispatch.total.approvals, misfires: dispatch.total.misfires, share: dispatch.total.share, failed: 0 });
  if (auto) {
    const sum = (k: "schedule" | "fleet") => auto.misfires.reduce((n, d) => n + d[k], 0);
    out.push({ lane: "SCHEDULE", switch: auto.switches.schedule, applied: auto.applied.schedule, misfires: sum("schedule"), share: share(sum("schedule"), auto.applied.schedule), failed: 0 });
    out.push({ lane: "FLEET PLAN", switch: auto.switches.fleetPlan, applied: auto.applied.fleet, misfires: sum("fleet"), share: share(sum("fleet"), auto.applied.fleet), failed: auto.applied.fleetFailed });
  }
  // 한 일 = 간격 규칙이 낸 막힘 에피소드, 몫은 닫힌 에피소드 중 스스로 풀린 것
  if (gap) out.push({ lane: "LANDING GAP", switch: gap.switch, applied: gap.episodes, misfires: gap.misfires, share: gap.share, failed: 0 });
  return out;
}

export const WHY_LABEL: Record<AutoMisfireLine["why"], string> = { undone: "되돌려짐", "stop-launch": "멈춘 뒤 LAUNCH", "idle-launch": "LAUNCH 뒤 놀음", "restart-loop": "재시작 반복" };

export const LANE_OF_KIND: Record<AutoMisfireLine["kind"], LaneName> = { schedule: "SCHEDULE", fleet: "FLEET PLAN" };

// 최근 misfire 줄: 새것부터(서버가 이미 새것부터 준다), 최대 n건
export const recentLinesOf = (auto: AutoView | null, n = 10): AutoMisfireLine[] => (auto?.recent ?? []).slice(0, n);
