import type { AircraftView, CrewMember, FleetFile, Rating } from "../../../../server/fleet.ts";
import type { FuelRemaining } from "../../../../server/fuel-remaining.ts";
import type { LaunchModelSetting } from "../../../../server/launch-model.ts";
import { apiSend, type ApiMethod } from "../../api.ts";

// FLEET 탭 여러 파일이 같이 쓰는 타입과 도우미(GET /api/fleet, /api/fleet/sessions)

export interface Configuration {
  id: string;
  label: string;
  complement: CrewMember[];
  ratings: Rating[];
}

export interface FleetBrief {
  ratings: Rating[];
  defaults: FleetFile["defaults"];
  projects: string[];
  aircraft: AircraftView[];
  configurations: Configuration[];
  airports: string[];
  defaultBase: string | null;
  nextRegistration: string | null;
  observedWindowDays?: number; // 관측 CREW를 세는 기간(옛 서버엔 없음)
  teamPattern?: string; // 라이브 값을 스냅샷으로 덮을 때 쓰는 REGISTRATION 규칙(ATC-100, 옛 서버엔 없음)
  dispatchMode?: "shadow" | "approval"; // CREW CHANGE 승인은 approval(2b)에서만(옛 서버엔 없음)
  fuelAccounts?: FuelRemaining[]; // ACCOUNT마다 FUEL과 구성원(ATC-60, 옛 서버엔 없음)
  launchAccount?: { aircraft: string | null; control: string | null; warnings: string[] }; // LAUNCH ACCOUNT(ATC-239, 옛 서버엔 없음)
  launchModel?: LaunchModelSetting; // LAUNCH MODEL(ATC-279): 기본·AIRPORT별·AIRCRAFT별(옛 서버엔 없음)
}

// GET /api/fleet/sessions: REGISTRATION 이름의 세션(claude agents --json)
export interface SessionRow {
  id?: string;
  name?: string;
  kind: string; // background | interactive
  status?: string;
  stale?: boolean; // 멈췄는데 Claude Code가 아직 목록에 둔 job(ATC-93). 살아 있는 세션이 아니다
  attachDir?: string; // 기본이 아닌 폴더의 background 세션이면 그 폴더(ATC-301). attach 명령이 CLAUDE_CONFIG_DIR로 붙인다
}
export interface SessionBrief {
  max: number;
  holders?: string; // 자리를 쥔 쪽(ATC-184): `AIRCRAFT 6 · 그 밖 1 (이름, 6h idle)`
  launched?: number; // 상한이 세는 살아 있는 백그라운드 세션 수(관제·STALE 뺌)
  permissionModes: string[];
  sessions: SessionRow[];
}

export const ratingHelp: Record<Rating, string> = {
  SEC: "DB·마이그레이션·RLS·인증·권한·보안·권리·배포·결제 (Codex Engineering Task)",
  UI: "화면·컴포넌트·시각 디자인·접근성",
  DATA: "언어 데이터·파이프라인·콘텐츠·분석",
  DOCS: "문서·규칙 파일·handoff",
};

export async function api(method: string, path: string, body?: unknown) {
  const res = await apiSend(method as ApiMethod, path, body || undefined);
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;

// LOGBOOK 띠(ATC-325)의 막대 하나가 말하는 결과. unexpected: TRIP FUEL 넘음이나 되돌림, nopr: PR 없이 ARRIVED(STAND 없는 FLIGHT),
// late: 기대 block time을 넘음, ontime: 안, unknown: 기대치나 소요 시간을 모름. 순수 함수: 색이 아니라 말이 이 값에서 나온다
export type LogOutcome = "unexpected" | "nopr" | "late" | "ontime" | "unknown";
export const LOG_OUTCOME_TEXT: Record<LogOutcome, string> = { unexpected: "UNEXPECTED", nopr: "PR 없음", late: "지연", ontime: "정시", unknown: "기대치 없음" };
export function logOutcomeOf(e: { pr?: unknown; onTime: boolean | null; reverted: boolean }, verdict?: string | null): LogOutcome {
  if (verdict === "unexpected" || e.reverted) return "unexpected";
  if (!e.pr) return "nopr";
  if (e.onTime === false) return "late";
  return e.onTime === true ? "ontime" : "unknown";
}
// 띠에 그리는 최근 FLIGHT: 가장 새것 n개를 시간 순으로(왼쪽이 오래된 것)
export const stripOf = <T,>(recent: readonly T[], n = 14): T[] => recent.slice(0, n).reverse();
