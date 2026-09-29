import type { AbsentAircraft } from "../../../../server/dispatch-launch.ts";

// 세션이 없는 백그라운드 AIRCRAFT(ATC-129, 스냅샷 absent). DISPATCH 후보로 남아 카드를 승인하면 LAUNCH한다.
// 마지막 턴이 사용 한도로 잘렸으면(cut) reset 뒤 같은 FLIGHT의 RESUME 카드가 나온다

export interface AbsentMark {
  label: string;
  title: string;
  resume: boolean;
}

const utc = (iso: string) => `${iso.slice(11, 16)}Z`;

// AOG면 DISPATCH가 받지 않으니 표시하지 않는다
export function absentMarkOf(x: AbsentAircraft | undefined, aog: boolean, now: number): AbsentMark | null {
  if (!x || aog) return null;
  const c = x.cut;
  if (!c)
    return {
      label: "absent · LAUNCH on approve",
      title: `세션 없음(마지막 atc LAUNCH ${utc(x.launchedAt)}). DISPATCH 카드를 승인하면 같은 옵션으로 LAUNCH한 뒤 FLIGHT PLAN을 보낸다`,
      resume: false,
    };
  const reset = c.resetsAt ? (now < Date.parse(c.resetsAt) ? `reset ${utc(c.resetsAt)}` : "reset 지남") : "reset 모름";
  return {
    label: `RESUME after LIMIT · ${reset}`,
    title: `마지막 턴이 ${utc(c.cutAt)} 사용 한도로 잘렸다${c.weekly ? "(weekly)" : ""}. reset이 지나면 쥐던 FLIGHT가 같은 AIRCRAFT의 RESUME 카드로 DISPATCH에 나온다${c.report ? ` — 마지막 보고: ${c.report}` : ""}`,
    resume: true,
  };
}

export function AbsentChip({ m }: { m: AbsentMark | null }) {
  if (!m) return null;
  return (
    <span className={`fl-r-health${m.resume ? " lv-alert" : ""}`} title={m.title}>
      {m.label}
    </span>
  );
}
