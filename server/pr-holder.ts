import { classOf, type FleetFile, profileOf, type Rating } from "./crew.ts";
import type { AircraftState, AssignPlan, Factor } from "./dispatch.ts";
import { regOfAircraft } from "./dispatch.ts";
import { compareRegistration } from "./registration.ts";
import { inSequence } from "./landing.ts";
import type { Clearance, PullRequest, Snapshot, Ticket, TrafficEvent } from "./model.ts";
import type { Proposal } from "./proposals.ts";
import { noHolderPickOf, offerKey } from "./relay-offer.ts";
import { lastAircraftOf, type LastAircraftInput } from "./relay.ts";

// PR HOLDER(ATC-354, docs/dispatch.md "PR holder"): 착륙 대기열의 PR에 STAND를 쥔 세션이 없고 GO AROUND나 FIX가 남아 있을 때
// 누가 이어받을지 고른다. 순수 함수만(자료 모으기는 pr-holder-run.ts, 카드 만들기는 proposals.ts의 syncOps).
// 순서: 그 FLIGHT를 마지막으로 난 AIRCRAFT가 이어받을 수 있으면 그것(resumed) → 아니면 TYPE RATING이 맞는 놀고 있는 AIRCRAFT → 없으면 RELAY(SUPERVISOR).
// FLIGHT가 없는 PR은 브랜치 이름으로 이슈를 찾고, 못 찾으면 DUTY.

export interface HolderAircraft {
  registration: string;
  airport: string | null; // 소속 AIRPORT 코드
  free: boolean; // 지금 새 일을 받을 수 있다(available이고 진행 중인 제안이 없다)
  ratings: readonly Rating[];
  launch?: boolean; // 세션이 없어 승인하면 LAUNCH하는 AIRCRAFT
  reason: string; // 못 받을 때의 사유(표시용)
}

export interface HolderInput {
  pull: Pick<PullRequest, "number" | "branch" | "ticketKey">;
  airport: string | null; // 그 PR 저장소의 AIRPORT 코드
  tickets: readonly Pick<Ticket, "key" | "labels">[];
  aircraft: readonly HolderAircraft[];
  lastAircraftOf: (flight: string | null) => string | null; // relay.ts의 lastAircraftOf
  keyFromBranch: (branch: string | null) => string | null; // sources/git.ts의 ticketKeyFromBranch
}

export type HolderChoice =
  | { kind: "assign"; flight: string; registration: string; resumed: boolean; launch: boolean; why: string }
  | { kind: "relay"; flight: string | null; why: string }
  | { kind: "duty"; why: string };

// 이 FLIGHT에 필요한 TYPE RATING. Risk 라벨과 rating:SEC는 늘 SEC다(classOf)
export const ratingsNeeded = (labels: readonly string[]): Rating[] => classOf([...labels]).ratings;

export function holderOf(x: HolderInput): HolderChoice {
  const byKey = new Map(x.tickets.map((t) => [t.key, t]));
  // FLIGHT: PR이 이미 안다 → 브랜치 이름에서 읽은 키가 실제 이슈면 그것. 둘 다 아니면 DUTY(이슈를 만들거나 PR을 정리)
  const flight = x.pull.ticketKey ?? (x.keyFromBranch(x.pull.branch) && byKey.has(x.keyFromBranch(x.pull.branch)!) ? x.keyFromBranch(x.pull.branch) : null);
  if (!flight) return { kind: "duty", why: "no FLIGHT linked by branch name" };
  const need = ratingsNeeded(byKey.get(flight)?.labels ?? []);
  const qualified = (a: HolderAircraft) => need.every((r) => a.ratings.includes(r));
  const here = (a: HolderAircraft) => x.airport === null || a.airport === x.airport;
  const takes = (a: HolderAircraft) => a.free && qualified(a) && here(a);

  const last = x.lastAircraftOf(flight);
  const lastAc = last ? x.aircraft.find((a) => a.registration.toUpperCase() === last.toUpperCase()) : undefined;
  if (lastAc && takes(lastAc)) return { kind: "assign", flight, registration: lastAc.registration, resumed: true, launch: lastAc.launch === true, why: `flew ${flight}` };

  // 놀고 있는 AIRCRAFT: 세션이 살아 있는 것이 먼저(LAUNCH가 필요 없다), 그다음 REGISTRATION 순
  const free = x.aircraft.filter(takes).sort((a, b) => Number(a.launch === true) - Number(b.launch === true) || compareRegistration(a.registration, b.registration));
  if (free[0]) return { kind: "assign", flight, registration: free[0].registration, resumed: false, launch: free[0].launch === true, why: need.length ? `TYPE RATING ${need.join("+")}` : "free AIRCRAFT" };

  const why = last && lastAc ? `${last}: ${qualified(lastAc) ? lastAc.reason : `no ${need.join("+")} rating`}` : need.length ? `no free AIRCRAFT with ${need.join("+")} rating` : "no free AIRCRAFT";
  return { kind: "relay", flight, why };
}

// PR 하나의 처리 키(저장소 이름#번호)와 head·type을 합친 카드 키. 같은 head·type은 한 번만 제안한다
export const holderKey = (pr: number, head: string, type: string) => `${pr}@${head.slice(0, 7)}|${type}`;

// 카드에 실리는 PR 자료(Proposal.prHolder). text는 TOWER가 보냈을 GO AROUND·FIX 글 그대로다
export interface PrHolder {
  key: string; // holderKey(pr, head, type)
  pr: number;
  repo: string; // 저장소 이름(마지막 마디)
  head: string; // 7자리
  type: "GO AROUND" | "FIX";
  text: string;
  reason: string;
  branch: string;
  stand: string | null;
  resumed: boolean; // 그 FLIGHT를 난 AIRCRAFT가 이어받는다
}

export type HolderRoute = HolderChoice["kind"];

export interface HolderPlans {
  plans: AssignPlan[];
  // offerKey(PR, type) → 어디로 갔나. relay만 SUPERVISOR QUEUE의 RELAY 카드가 된다
  routes: Map<string, { kind: HolderRoute; pr: number; repo: string; flight: string | null }>;
}

export interface HolderPlanInput {
  clearances: readonly Clearance[];
  events: readonly TrafficEvent[];
  existing: readonly Proposal[];
  lastAircraft: LastAircraftInput;
  fleet: FleetFile;
  aircraft: readonly AircraftState[];
  teamPattern?: string;
  assigned?: readonly string[]; // 이번 계획이 ASSIGN·RESUME으로 이미 고른 AIRCRAFT(REGISTRATION). 같은 AIRCRAFT에 카드를 하나 더 얹지 않는다
  keyFromBranch: (branch: string | null) => string | null;
  now: number;
}

const repoName = (repo: string) => repo.replace(/\/+$/, "").split("/").pop() || repo;
// 같은 head·type의 카드가 어디까지 왔나. live: 판정 대기·승인·진행 중(계획에 그대로 둔다). dead: 거절·UNABLE·RECALL 등으로 끝난 카드(또 제안하지 않고 SUPERVISOR가 정한다, RELAY 카드).
// superseded·expired는 없는 것으로 보고 다시 제안할 수 있다
const LIVE = new Set(["proposed", "agreed", "disagreed", "approved", "sent", "accepted", "departed", "recalling"]);
const cardOf = (existing: readonly Proposal[], key: string): { live: Proposal } | { dead: true } | null => {
  const mine = existing.filter((p) => p.prHolder?.key === key && p.status !== "superseded" && p.status !== "expired");
  const live = mine.find((p) => LIVE.has(p.status));
  return live ? { live } : mine.length ? { dead: true } : null;
};
// 열린 제안(판정 대기·승인됨)을 쥔 AIRCRAFT. 새 PR HOLDER 카드를 얹지 않는다
const OPEN = new Set(["proposed", "agreed", "disagreed", "approved"]);

export function holderPlansOf(s: Pick<Snapshot, "pulls" | "claims" | "workspaces" | "airports" | "tickets">, x: HolderPlanInput): HolderPlans {
  const routes: HolderPlans["routes"] = new Map();
  const plans: AssignPlan[] = [];
  // 이번 계산에서 이미 쓴 AIRCRAFT: 계획이 고른 것과 열린 제안(ASSIGN·RESUME·다른 PR HOLDER 카드)을 쥔 것, 그리고 아래에서 고르는 것
  const used = new Set<string>([...(x.assigned ?? []), ...x.existing.filter((p) => p.kind === "ASSIGN" && OPEN.has(p.status)).map((p) => p.registration ?? p.aircraftName ?? "").filter(Boolean)]);
  const wsByPath = new Map(s.workspaces.map((w) => [w.path, w]));
  const base = (): HolderAircraft[] =>
    x.aircraft.map((a) => {
      const registration = regOfAircraft(a, x.teamPattern);
      return {
        registration,
        airport: a.airport,
        free: a.available && !a.reserved && !a.stopped && !a.restarting && !used.has(registration),
        ratings: profileOf(x.fleet, a.name).ratings,
        ...(a.launch ? { launch: true } : {}),
        reason: a.reserved ? `진행 중인 제안 ${a.reserved}` : a.reason,
      };
    });
  for (const p of s.pulls.filter(inSequence)) {
    const pick = noHolderPickOf(p, s, x);
    if (!pick) continue;
    const key = holderKey(p.number, p.head, pick.type);
    const rkey = offerKey(p, pick.type);
    const repo = repoName(p.repo);
    const card = cardOf(x.existing, key);
    if (card) {
      const flight = p.ticketKey ?? null;
      if ("dead" in card) {
        routes.set(rkey, { kind: "relay", pr: p.number, repo, flight }); // 거절된 holder: 같은 head에 또 제안하지 않고 SUPERVISOR에게(RELAY 카드)
        continue;
      }
      routes.set(rkey, { kind: "assign", pr: p.number, repo, flight });
      // 살아 있는 카드는 계획에 그대로 둬야 syncOps가 매 주기 닫지 않는다
      const c = card.live;
      plans.push({ kind: "ASSIGN", flight: c.flight, aircraft: c.aircraft ?? "", aircraftName: c.aircraftName ?? "", ...(c.registration ? { registration: c.registration } : {}), airport: c.airport ?? "", score: c.score, factors: c.factors, ...(c.launch ? { launch: true as const } : {}), prHolder: c.prHolder! });
      continue;
    }
    const airport = s.airports.find((a) => a.repo === p.repo)?.code ?? null;
    const choice = holderOf({ pull: p, airport, tickets: s.tickets, aircraft: base(), lastAircraftOf: (f) => lastAircraftOf(f, x.lastAircraft), keyFromBranch: x.keyFromBranch });
    routes.set(rkey, { kind: choice.kind, pr: p.number, repo, flight: choice.kind === "duty" ? null : choice.flight });
    if (choice.kind !== "assign") continue;
    used.add(choice.registration);
    const ac = x.aircraft.find((a) => regOfAircraft(a, x.teamPattern) === choice.registration)!;
    const factor: Factor = { id: "holder", label: "PR HOLDER", value: 1, weight: 0, points: 0, detail: `PR #${p.number} · ${pick.type} · ${choice.resumed ? "flew this FLIGHT" : choice.why}` };
    plans.push({
      kind: "ASSIGN",
      flight: choice.flight,
      aircraft: ac.id,
      aircraftName: ac.name,
      registration: choice.registration,
      airport: airport ?? ac.airport ?? "",
      score: 0,
      factors: [factor],
      ...(choice.launch ? { launch: true as const } : {}),
      prHolder: { key, pr: p.number, repo, head: p.head.slice(0, 7), type: pick.type === "FIX" ? "FIX" : "GO AROUND", text: pick.text, reason: pick.reason, branch: p.branch, stand: p.standPath && wsByPath.has(p.standPath) ? p.standPath : null, resumed: choice.resumed },
    });
  }
  return { plans, routes };
}

// FLIGHT PLAN에 넣는 줄(영어, ATC-126). 이어받는 AIRCRAFT는 머지하지 않는다
export function holderLines(h: PrHolder): string[] {
  return [
    `PR HOLDER — PR #${h.pr} (head ${h.head}) has no live STAND holder and a pending ${h.type}. You hold it now${h.resumed ? " (you flew this FLIGHT)" : ""}: continue on branch ${h.branch}${h.stand ? ` · STAND ${h.stand}` : " (no STAND found; open one from this branch)"}. Do not merge; the landing rules are unchanged.`,
    `Pending ${h.type} (${h.reason}):`,
    ...h.text.split("\n").map((l) => `> ${l}`),
  ];
}
