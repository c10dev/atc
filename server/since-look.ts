// SINCE YOU LAST LOOKED(ATC-383, docs/guide/screens.md): "현재 상태 확인"에 답하는 한 줄. 마지막으로 본 뒤 무엇이 바뀌었나(발권·착륙 ON·배포 IN)와
// 지금 막힌 것·SUPERVISOR를 기다리는 것의 수. 새 감지는 없다 — 발권 기록, OOOI, 알림 목록을 센다. 순수 함수만. 읽기와 표시는 since-look-run.ts

export interface SinceLookWaiting {
  key: string;
  text: string;
  link: string;
}

export interface SinceLook {
  since: string; // 마지막으로 본 시각(ISO). 이 뒤의 일만 센다
  released: string[]; // 그 뒤 발권된 FLIGHT key(정렬, 중복 없음)
  landed: string[]; // 그 뒤 착륙(ON)한 FLIGHT
  deployed: string[]; // 그 뒤 배포(IN)된 FLIGHT
  stuck: string[]; // 지금 막힌 FLIGHT(시점과 무관한 지금 상태)
  waiting: SinceLookWaiting[]; // 지금 SUPERVISOR를 기다리는 항목(cue call)
  line: string; // 서버가 쓴 한 줄. 조용하면 빈 문자열(화면은 아무것도 그리지 않는다)
}

export interface SinceLookInput {
  lastLook: string; // ISO
  releases: { flight: string; at: string }[];
  milestones: Iterable<[string, { on: string | null; in: string | null }]>;
  stuckFlights: string[];
  waiting: SinceLookWaiting[];
}

const after = (iso: string | null | undefined, t: number) => Boolean(iso) && Date.parse(iso!) > t;
const uniq = (xs: string[]) => [...new Set(xs)].sort();

// 한 줄: 센 것만 이어 쓴다. 0인 칸은 쓰지 않는다
export function lineOf(v: Omit<SinceLook, "line" | "since">): string {
  return [
    v.released.length && `발권 ${v.released.length}`,
    v.landed.length && `착륙(ON) ${v.landed.length}`,
    v.deployed.length && `배포(IN) ${v.deployed.length}`,
    v.stuck.length && `막힘 ${v.stuck.length}`,
    v.waiting.length && `기다림 ${v.waiting.length}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function sinceLookOf(inp: SinceLookInput): SinceLook {
  const t = Date.parse(inp.lastLook);
  const ms = [...inp.milestones];
  const v = {
    released: uniq(inp.releases.filter((r) => after(r.at, t)).map((r) => r.flight)),
    landed: uniq(ms.filter(([, m]) => after(m.on, t)).map(([f]) => f)),
    deployed: uniq(ms.filter(([, m]) => after(m.in, t)).map(([f]) => f)),
    stuck: uniq(inp.stuckFlights),
    waiting: [...inp.waiting].sort((a, b) => a.key.localeCompare(b.key)),
  };
  return { since: inp.lastLook, ...v, line: lineOf(v) };
}

// 마지막 본 시각 옮기기: 뒤로 가지 않고 지금을 넘지 않는다. 화면이 그린 시각(at)을 받으면 그 뒤에 생긴 일을 놓치지 않는다
export function nextLook(current: string, at: string | null | undefined, now: number): string {
  const cur = Date.parse(current);
  const want = at && Number.isFinite(Date.parse(at)) ? Date.parse(at) : now;
  return new Date(Math.max(cur, Math.min(want, now))).toISOString();
}
