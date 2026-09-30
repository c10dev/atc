import type { ServerSettings } from "./settings.ts";

// 설정 창 AUTOMATION 탭의 계산(ATC-131). SUPERVISOR 정책 스위치의 "지금 모드 한 줄", ⚠ 모드로 올릴 때 확인이 필요한지, 마지막 탭 기억.
// 저장 값과 PUT /api/settings는 그대로다. 여기는 화면에 보이는 이름과 판단만 다룬다.
export type PolicyKey = "autoland" | "mcc" | "jev" | "fuelHold" | "review" | "reposition" | "recycle";

// ⚠ 모드(올리면 atc가 더 많이 쓰거나 밖으로 내보낸다). 화면의 경고 문구가 ⚠로 시작하는 모드와 같다
export const RISKY: Record<PolicyKey, readonly string[]> = {
  autoland: ["update", "merge"],
  mcc: ["land", "land+rts", "rts"], // rts도 ⚠: 사용자가 머지한 main을 서버가 스스로 배포한다(MCC_WARN)
  jev: ["replay", "shadow"], // 티켓 제목과 허용한 칸이 TypeSafe로 나간다
  fuelHold: ["on"],
  review: ["deepseek"], // 보안 PR도 REVIEW 세션에 보낸다
  reposition: ["auto"], // atc가 쉬는 AIRCRAFT의 base를 스스로 옮긴다(멈추고 다른 저장소에서 다시 띄움)
  recycle: ["on"], // atc가 관제 세션을 스스로 STOP·LAUNCH한다(shadow는 기록만)
};

export const isRisky = (key: PolicyKey, mode: string): boolean => RISKY[key].includes(mode);

// 지금 모드에서 to로 옮길 때 확인 단계가 필요한가. 같은 값이면 저장할 것이 없고, ⚠ 모드로 가면(⚠에서 ⚠로도) 늘 확인한다. 내리는 것은 그대로 저장
export const needsConfirm = (key: PolicyKey, from: string, to: string): boolean => from !== to && isRisky(key, to);

// CONTROL RECYCLE의 세션별 auto 스위치(ATC-175): alert → auto로 올리면 mode `on`처럼 ⚠ 확인이 필요하다(모든 세션). 내리는 것은 확인 없이 저장.
// OCC는 문구가 따로다: 도착 보고 틈과 CHARTER REQUEST가 닫힌 뒤(ATC-169)에만 켠다
export function recycleAutoGuardOf(session: string, wasAuto: boolean, to: "auto" | "alert"): { line: string; warn: boolean } | null {
  if (to !== "auto" || wasAuto) return null;
  const base = "auto ⚠ 이 세션도 atc가 스스로 STOP·LAUNCH한다(CAP을 넘고 턴 사이이며 안전한 순간에, 스위치가 on일 때).";
  return { line: session === "OCC" ? `${base} OCC는 도착 보고 기록·wip CHARTER REQUEST 매뉴얼(ATC-169)이 돌고 있을 때만 켠다.` : base, warn: true };
}

// REVIEW의 보이는 이름. 저장 값은 dispatch.json의 `deepseek` 그대로다(옛 이름, 뜻은 "REVIEW 세션에 보냄")
export const reviewLabel = (v: string): string => (v === "deepseek" ? "sonnet (deepseek)" : v);

export interface ModeSegment {
  key: PolicyKey;
  label: string; // AUTOLAND, MCC, JEV, FUEL HOLD, REVIEW
  value: string; // 보이는 값
  warn: boolean;
}
// 탭 맨 위 한 줄: `AUTOLAND off · MCC land · JEV off · FUEL HOLD off · REVIEW exclude`. ⚠ 모드는 warn
export function modeSegments(s: Pick<ServerSettings, "autoland" | "mcc" | "review"> & Partial<Pick<ServerSettings, "judges" | "fuel" | "controlRecycle" | "fleetPlan">>): ModeSegment[] {
  const seg = (key: PolicyKey, label: string, mode: string, value = mode): ModeSegment => ({ key, label, value, warn: isRisky(key, mode) });
  return [
    seg("autoland", "AUTOLAND", s.autoland.mode),
    seg("mcc", "MCC", s.mcc.mode),
    seg("jev", "JEV", s.judges?.jev.mode ?? "off"),
    seg("fuelHold", "FUEL HOLD", s.fuel?.hold ? "on" : "off"),
    seg("review", "REVIEW", s.review.security, reviewLabel(s.review.security)),
    ...(s.controlRecycle ? [seg("recycle", "CONTROL RECYCLE", s.controlRecycle.mode)] : []),
    ...(s.fleetPlan ? [seg("reposition", "REPOSITION", s.fleetPlan.reposition)] : []),
  ];
}
export const modeLine = (segs: readonly ModeSegment[]): string => segs.map((x) => `${x.label} ${x.value}`).join(" · ");

// 설정 창이 다시 열릴 때 마지막 탭. 저장된 값이 없거나 모르는 값이면 fallback(화면)
export const settingsTabOf = <T extends string>(stored: string | null | undefined, ids: readonly T[], fallback: T): T => ids.find((id) => id === stored) ?? fallback;
