import type { FuelRemaining } from "./fuel-remaining.ts";
import type { RtsRecord } from "./mcc.ts";
import type { SinceLook } from "./since-look.ts";
import type { SupervisorAlert } from "./supervisor-alerts.ts";
import { needsYouOf, type WaitingOnPerson } from "./waiting-person.ts";

// SUPERVISOR SUMMARY(ATC-153, docs/mac-app.md 3): 메뉴 막대·브라우저·atc-app이 같은 숫자를 읽게 서버가 한 번 계산한다.
// 알림 목록(supervisor-alerts.ts)의 항목에서 세므로 화면 목록과 어긋나지 않는다. 순수 함수만. 읽기는 supervisor-alerts-run.ts
// 필드 이름은 v: 1 안에서 바꾸지 않는다(atc-app이 고정한다). 필드 목록은 server/README의 표에 있다.

export const SUMMARY_V = 1;

export interface SummaryFuelWindow {
  name: string;
  pct: number;
  resetsAt: string;
}
export interface SupervisorSummary {
  v: typeof SUMMARY_V;
  at: string; // 이 값을 만든 시각(ISO). 내용이 같으면 SSE로 다시 보내지 않으므로 `at`은 내용 비교에서 뺀다
  master: "warning" | "caution" | null;
  counts: { warning: number; caution: number; advisory: number };
  pending: { dispatch: number; humanCheck: number; tool: number; schedule: number };
  fuel: { label: string; windows: SummaryFuelWindow[] } | null;
  rts: { result: RtsRecord["result"]; at: string; from: string | null; to: string } | null;
  working: { aircraft: number; control: number };
  needsYou: string[]; // 스스로 사람을 기다리는 팀 AIRCRAFT의 이름(ATC-374, waiting-person.ts). 판정을 기다리는 DISPATCH 카드는 여기 없고 pending.dispatch로만 센다
  sinceLook?: SinceLook; // ATC-383: 마지막으로 본 뒤 바뀐 것의 수와 한 줄(v: 1에 더한 칸). summaryOf는 채우지 않고 summaryNow가 채운다
}

export interface SummaryInput {
  items: Pick<SupervisorAlert, "key" | "level" | "cue" | "aircraft">[];
  waiting: readonly WaitingOnPerson[]; // SUPERVISOR QUEUE의 NEEDS YOU·GO와 같은 정의(waitingOnPersonOf)
  fuelAccounts: Pick<FuelRemaining, "group" | "account" | "windows">[];
  rts: Pick<RtsRecord, "at" | "from" | "to" | "result"> | null;
  working: { aircraft: number; control: number };
  at: string;
}

const count = (items: SummaryInput["items"], prefix: string) => items.filter((i) => i.key.startsWith(prefix)).length;

// 가장 많이 쓴 ACCOUNT: 창 하나라도 가장 높은 사용률(먼저 막히는 쪽). 같으면 먼저 온 것
export function topFuelOf(accounts: SummaryInput["fuelAccounts"]): SupervisorSummary["fuel"] {
  const used = (a: SummaryInput["fuelAccounts"][number]) => Math.max(0, ...a.windows.map((w) => w.pct));
  let top: SummaryInput["fuelAccounts"][number] | undefined;
  for (const a of accounts) if (!top || used(a) > used(top)) top = a;
  return top ? { label: top.account ?? top.group, windows: top.windows.map((w) => ({ name: w.name, pct: w.pct, resetsAt: w.resetsAt })) } : null;
}

export function summaryOf(inp: SummaryInput): SupervisorSummary {
  const by = (l: "warning" | "caution" | "advisory") => inp.items.filter((i) => i.level === l).length;
  const counts = { warning: by("warning"), caution: by("caution"), advisory: by("advisory") };
  // 스스로 사람을 기다리는 AIRCRAFT(ATC-374). 판정 카드(pending.dispatch)·HUMAN CHECK는 AIRCRAFT의 기다림이 아니라 센 수로만 있다
  const needsYou = needsYouOf(inp.waiting);
  return {
    v: SUMMARY_V,
    at: inp.at,
    master: counts.warning ? "warning" : counts.caution ? "caution" : null,
    counts,
    pending: { dispatch: count(inp.items, "pending|proposal|") + count(inp.items, "follow|approve|"), humanCheck: count(inp.items, "pending|humancheck|"), tool: count(inp.items, "pending|tool|"), schedule: count(inp.items, "pending|schedule|") },
    fuel: topFuelOf(inp.fuelAccounts),
    rts: inp.rts ? { result: inp.rts.result, at: inp.rts.at, from: inp.rts.from, to: inp.rts.to } : null,
    working: inp.working,
    needsYou,
  };
}

// 내용이 같으면 같은 문자열(`at` 제외). SSE `summary`는 이 값이 바뀔 때만 보낸다
export const summaryKey = (s: SupervisorSummary): string => JSON.stringify({ ...s, at: undefined });

// /api/events?topics=: 쉼표로 나눈 목록. 없거나 비면 지금까지와 같이 summary·radio·duty를 뺀 전부. ping은 늘 보낸다
export const TOPICS = ["snapshot", "alert", "version", "summary", "radio", "duty"] as const;
export type Topic = (typeof TOPICS)[number];
export const DEFAULT_TOPICS: readonly Topic[] = ["snapshot", "alert", "version"];

export function parseTopics(raw: string | undefined): { ok: true; topics: Set<Topic> } | { ok: false; unknown: string[] } {
  const parts = (raw ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (!parts.length) return { ok: true, topics: new Set(DEFAULT_TOPICS) };
  const unknown = parts.filter((t) => !(TOPICS as readonly string[]).includes(t));
  if (unknown.length) return { ok: false, unknown };
  return { ok: true, topics: new Set(parts as Topic[]) };
}

// 일하는 세션 수(스냅샷의 세션에서). AIRCRAFT는 살아 있는 busy 세션이 있는 REGISTRATION 수, 관제 세션은 이름이 관제 세션 목록에 있는 busy 세션 수
export function workingOf(sessions: { name: string; status: string }[], isAircraft: (name: string) => string | null, controlNames: readonly string[]): { aircraft: number; control: number } {
  const control = new Set(controlNames.map((n) => n.toUpperCase()));
  const aircraft = new Set<string>();
  let ctl = 0;
  for (const s of sessions) {
    if (s.status !== "busy") continue;
    if (control.has(s.name.toUpperCase())) ctl++;
    else {
      const reg = isAircraft(s.name);
      if (reg) aircraft.add(reg);
    }
  }
  return { aircraft: aircraft.size, control: ctl };
}
