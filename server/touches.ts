// SUPERVISOR TOUCHES(ATC-512, docs/autonomy.md 2절·3절 원칙 1): UTC 하루마다 "머지된 PR 하나당 SUPERVISOR가 손댄 횟수"를 범주별로 센다.
// 순수 함수만 둔다(파일은 touches-run.ts). 기존 기록만 읽고 새 기록을 만들지 않는다. 조절하는 것이 없어서 스위치도 misfire 카운터도 없다.
// 읽는 방법은 ATC-465(arm-metrics.ts)와 같은 기록이다: RELAY create, 사람이 한 승인(auto가 아닌 것).

export type Category = "release" | "merge" | "linear" | "fleet" | "duty" | "relay" | "card";
export type Side = "gate" | "leak";

export interface CategoryInfo {
  id: Category;
  label: string;
  side: Side;
  source: string | null; // null: 아직 기록이 없다("not recorded")
  note: string | null; // 읽는 범위의 한계
}

// 세 gate(K1~K3, autonomy.md 2절)는 릴리스 때 선언한 효과로 한 번 승인한다(6절, 원칙 1·10): 그래서 gate 쪽은 release 하나다.
// 나머지는 릴리스 뒤에 사람이 거친 단계, 곧 leak이다. 여기서 정하는 것이 아니라 autonomy.md의 말을 옮긴 표다.
export const CATEGORIES: readonly CategoryInfo[] = [
  { id: "release", label: "release", side: "gate", source: "releases.jsonl (op release)", note: "K1–K3 효과를 릴리스 때 선언해 한 번 승인한다(autonomy.md 2절·6절)" },
  { id: "merge", label: "merge", side: "leak", source: null, note: "GitHub에서 직접 한 머지는 기록이 없다. MCC·AUTOLAND의 머지는 사람 손이 아니라 세지 않는다" },
  { id: "linear", label: "Linear hand edit", side: "leak", source: null, note: null },
  { id: "fleet", label: "FLEET/CONTROL action", side: "leak", source: "fleet-plan.jsonl (approve by SUPERVISOR)", note: "FLEET PLAN 카드 승인만 센다. CONTROL 버튼은 기록이 없다" },
  { id: "duty", label: "DUTY message", side: "leak", source: null, note: null },
  { id: "relay", label: "RELAY", side: "leak", source: "relays.jsonl (op create)", note: null },
  { id: "card", label: "card decision", side: "leak", source: "proposals.jsonl·schedule.jsonl (사람이 한 approve·verdict)", note: "auto(서버)와 atfm(ATFM 자동)은 사람 손이 아니라 세지 않는다. crosscheck는 SUPERVISOR가 CROSSCHECK에 한 번에 동의한 것이라 센다" },
];

export interface TouchInput {
  releases: { op: string; at: string }[];
  relays: { op: string; at: string }[];
  proposals: { op: string; at: string; via?: string }[];
  schedule: { op: string; at: string; via?: string }[];
  fleetPlan: { op: string; at: string; by?: string }[];
  mcc: { op: string; at: string; pr?: number; result?: string }[];
  autoland: { op: string; at: string; slug?: string; number?: number; result?: string }[];
}

export interface DayRow {
  day: string; // UTC YYYY-MM-DD
  landed: number;
  counts: Record<Category, number | null>; // null: 기록 없음(0이 아니다)
  gate: number;
  leaks: number;
  touches: number; // 기록된 범주의 합
  perPr: number | null; // landed 0이면 null("—")
  leaksPerPr: number | null;
}

export interface TouchesView {
  at: string;
  days: number;
  categories: readonly CategoryInfo[];
  rows: DayRow[]; // 오늘부터 거슬러
}

// UTC 날짜(자정 경계는 다음 날). 읽을 수 없는 시각은 null
export const utcDay = (t: string): string | null => {
  const n = Date.parse(t);
  return Number.isFinite(n) ? new Date(n).toISOString().slice(0, 10) : null;
};

// 사람 손: via가 없는 옛 줄도 센다. 서버가 한 auto와 ATFM이 한 atfm만 뺀다(schedule.ts humanOf와 같다). crosscheck는 SUPERVISOR의 한 번 클릭 동의다
const humanVia = (via: string | undefined) => via !== "auto" && via !== "atfm";
const round1 = (x: number) => Math.round(x * 10) / 10;

export function touchesView(inp: TouchInput, nowMs: number, days: number): TouchesView {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const dayList: string[] = [];
  for (let i = 0; i < days; i++) dayList.push(new Date(Date.parse(`${today}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10));
  const rows = new Map<string, { counts: Record<Category, number>; landed: Set<string> }>();
  for (const d of dayList) rows.set(d, { counts: { release: 0, merge: 0, linear: 0, fleet: 0, duty: 0, relay: 0, card: 0 }, landed: new Set() });
  const bump = (at: string, c: Category) => {
    const d = utcDay(at);
    const r = d ? rows.get(d) : undefined;
    if (r) r.counts[c]++;
  };

  for (const r of inp.releases) if (r.op === "release") bump(r.at, "release");
  for (const r of inp.relays) if (r.op === "create") bump(r.at, "relay");
  for (const r of inp.fleetPlan) if (r.op === "approve" && r.by === "SUPERVISOR") bump(r.at, "fleet");
  for (const r of inp.proposals) if (r.op === "approve" && humanVia(r.via)) bump(r.at, "card");
  for (const r of inp.schedule) if ((r.op === "approve" || r.op === "verdict") && humanVia(r.via)) bump(r.at, "card");
  // 착륙한 PR: MCC land ok, AUTOLAND merge ok. 키는 저장소 이름#번호 하나(MCC는 atc 저장소)라 두 기록이 같은 PR을 적어도 한 번만 센다
  const land = (at: string, key: string) => {
    const d = utcDay(at);
    if (d) rows.get(d)?.landed.add(key);
  };
  for (const r of inp.mcc) if (r.op === "land" && r.result === "ok" && r.pr != null) land(r.at, `atc#${r.pr}`);
  for (const r of inp.autoland) if (r.op === "merge" && r.result === "ok" && r.number != null) land(r.at, `${(r.slug ?? "?").split("/").pop()}#${r.number}`);

  const recorded = CATEGORIES.filter((c) => c.source);
  const out: DayRow[] = dayList.map((day) => {
    const r = rows.get(day)!;
    const counts = {} as Record<Category, number | null>;
    for (const c of CATEGORIES) counts[c.id] = c.source ? r.counts[c.id] : null;
    const sum = (side: Side) => recorded.filter((c) => c.side === side).reduce((n, c) => n + r.counts[c.id], 0);
    const gate = sum("gate");
    const leaks = sum("leak");
    const landed = r.landed.size;
    return { day, landed, counts, gate, leaks, touches: gate + leaks, perPr: landed ? round1((gate + leaks) / landed) : null, leaksPerPr: landed ? round1(leaks / landed) : null };
  });
  return { at: new Date(nowMs).toISOString(), days, categories: CATEGORIES, rows: out };
}
