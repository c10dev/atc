import type { FollowStuck } from "./follow.ts";

// 막힘 알림 문구(ATC-522): DISPATCH가 plan.unserved에 올린 Todo FLIGHT의 follow|stuck가 "제안 없이 Todo n분" 대신 왜 못 받는지(why)와
// SUPERVISOR가 할 한 걸음을 적는다. 순수 함수만 — 스위치(dispatch.json stuckUnserved)와 센 수는 stuck-unserved-run.ts.
// 열린 제안·HOLD·선행 FLIGHT 같은 다른 막힘은 unserved가 없어 옛 문구 그대로다.

export type StuckUnservedSwitch = "off" | "on";
export const parseStuckUnserved = (v: unknown): StuckUnservedSwitch => (v === "off" ? "off" : "on");

export type UnservedDetail = NonNullable<FollowStuck["unserved"]>;

const WHY_LABEL: Record<UnservedDetail["why"], string> = {
  "no-aircraft": "받을 AIRCRAFT 없음",
  unqualified: "필요한 RATING을 가진 AIRCRAFT 없음",
  "no-tail": "지정한 tail의 세션 없음",
};

// 알림 한 줄의 글과 다음 한 걸음. k3Relaunch는 K3 RELAUNCH 스위치가 켜졌나
export function unservedStuckOf(u: UnservedDetail, k3Relaunch: boolean): { text: string; next: string } {
  const head = `${WHY_LABEL[u.why]}(${u.why}) · AIRPORT ${u.airport}`;
  const need = u.ratings.length ? ` · RATING ${u.ratings.join("+")}` : "";
  if (u.why === "no-tail") return { text: `${head} · ${u.tails.join(", ")}`, next: `FLEET 탭에서 ${u.tails.join(", ")} AIRCRAFT를 LAUNCH한다` };
  if (u.why === "unqualified") return { text: `${head}${need}`, next: `FLEET 탭에서 ${u.ratings.join("+") || "필요한"} RATING을 가진 AIRCRAFT를 ${u.airport}에 두거나 RATING을 준다` };
  if (u.k3)
    return {
      text: `${head}${need} · K3 FLIGHT는 새로 띄운 AIRCRAFT만 받는데 후보가 모두 바쁨`,
      next: k3Relaunch
        ? "FLEET PLAN의 K3 RELAUNCH 카드를 승인하거나, 쉬는 AIRCRAFT를 STOP해 새 LAUNCH가 가능하게 한다"
        : "SETTINGS에서 K3 RELAUNCH(k3Relaunch)를 켜거나, 쉬는 AIRCRAFT를 STOP해 새 LAUNCH가 가능하게 한다",
    };
  const absent = u.at.find((a) => a.launch);
  if (absent) return { text: `${head}${need}`, next: `FLEET 탭에서 ${absent.name}을 LAUNCH한다(${u.airport} 소속, 지금 세션 없음)` };
  if (u.at.length) return { text: `${head}${need} · ${u.airport} 소속 AIRCRAFT가 모두 바쁨`, next: `끝나길 기다리거나 FLEET 탭에서 ${u.airport} 소속 AIRCRAFT를 하나 더 LAUNCH한다` };
  return { text: `${head}${need} · ${u.airport} 소속 AIRCRAFT 없음`, next: `FLEET 탭에서 base가 ${u.airport}인 AIRCRAFT를 LAUNCH한다(한 번도 안 떴으면 첫 LAUNCH)` };
}

// 센 수(읽기만): FLIGHT RECORDER의 stuck-unserved 줄을 days일 안에서 센다
export function stuckUnservedCountOf(records: readonly { t: string; op?: string }[], now: number, days = 7): number {
  const since = now - days * 86_400_000;
  return records.filter((r) => r.op === "stuck-unserved" && Date.parse(r.t) >= since).length;
}
