import { fixOf } from "./fix.ts";
import { goAroundOf } from "./go-around.ts";
import { inSequence } from "./landing.ts";
import type { Clearance, PullRequest, Snapshot, TrafficEvent } from "./model.ts";
import { liveHolderClaims } from "./occupancy.ts";
import { lastAircraftOf, type LastAircraftInput, type Relay, type RelayType } from "./relay.ts";

// RELAY 제안(ATC-308): GO AROUND나 FIX가 있는데 그 PR의 STAND를 쥔 세션이 없어 TOWER가 못 보낼 때(`action: "supervisor"`, `why: "no-holder"`)
// SUPERVISOR QUEUE에 카드 하나를 둔다. SUPERVISOR가 한 번 확인하면 TOWER 자신의 글을 그대로 그 FLIGHT를 난 AIRCRAFT에게, 그 STAND에 묶은 CLEARANCE로 전한다.
// 글은 brief의 landingQueue[].goAround.text·fix.text를 만드는 같은 함수(goAroundOf·fixOf)에서 온다. 순수 함수만(자료 모으기는 supervisor-queue-run.ts).
// `why: "repeat"`(한 시간 안 두 번째)는 지금처럼 SUPERVISOR 보고만이다(이 길 밖).

export interface RelayOffer {
  key: string; // `<저장소>#<번호>@<head 7자리>|<type>`: PR과 head마다 하나. head가 바뀌면 다른 key
  type: RelayType;
  repo: string;
  pr: number;
  head: string; // 7자리
  flight: string | null;
  airport: string | null; // AIRPORT 코드
  stand: string | null; // 그 PR의 STAND 경로(없으면 null: FLIGHT로만 묶는다)
  standName: string | null;
  text: string; // TOWER의 글, 고치지 않는다
  to: string | null; // 제안하는 받는 AIRCRAFT(REGISTRATION). 모르면 null: SUPERVISOR가 고른다
  reason: string; // GO AROUND의 이유(dirty·behind·prevMerged) 또는 FIX의 지적 출처
  noHolder: string | null; // PR HOLDER가 이 카드를 SUPERVISOR에게 넘긴 사유(ATC-392): 그 AIRPORT에 AIRCRAFT 없음, TYPE RATING 없음, 한도·진행 중 등. 모르면 null
}

export interface OfferInput {
  clearances: readonly Clearance[];
  events: readonly TrafficEvent[];
  relays: readonly Pick<Relay, "type" | "pr" | "text" | "status">[];
  lastAircraft: LastAircraftInput;
  now: number;
  // PR HOLDER(ATC-354, pr-holder.ts)의 경로. 주면 relay로 간 PR만 카드가 된다(AIRCRAFT가 이어받거나 DUTY로 가면 SUPERVISOR 카드가 없다). 안 주면 지금처럼 모두
  holderRoutes?: ReadonlyMap<string, { kind: string; why?: string }> | null;
}

type OfferSnapshot = Pick<Snapshot, "pulls" | "claims" | "workspaces" | "airports"> & Partial<Pick<Snapshot, "sessions">>;

const repoName = (repo: string) => repo.replace(/\/+$/, "").split("/").pop() || repo;
export const offerKey = (p: Pick<PullRequest, "repo" | "number" | "head">, type: RelayType) => `${repoName(p.repo)}#${p.number}@${p.head.slice(0, 7)}|${type}`;

// 같은 PR·type·head로 이미 만든 relay(어느 상태든). 있으면 카드를 또 내지 않는다: queued·issued는 TOWER가 곧 보내고, undeliverable은 UNDELIVERED 카드가 맡는다
const taken = (relays: OfferInput["relays"], type: RelayType, pr: number, head: string) => relays.some((r) => r.type === type && r.pr === pr && r.text.includes(`head ${head}`));

export interface Pick1 {
  type: RelayType;
  text: string;
  reason: string;
}

// 이 PR에 STAND를 쥔 세션이 없을 때 TOWER가 못 보내는 글 하나(GO AROUND가 먼저). 없으면 null. 카드(relayOffersOf)와 PR 서랍이 같은 글을 쓴다
export function noHolderPickOf(p: PullRequest, s: Pick<Snapshot, "pulls" | "claims"> & Partial<Pick<Snapshot, "sessions">>, x: Pick<OfferInput, "clearances" | "events" | "now">): Pick1 | null {
  const holders = liveHolderClaims(s.claims, p.standPath, s.sessions).length; // 끝난 세션의 점유는 홀더가 아니다(ATC-440)
  if (holders) return null; // 살아 있는 세션이 쥐고 있으면 TOWER가 그에게 보낸다
  // brief와 같이 이 PR을 연 뒤 같은 STAND(없으면 같은 FLIGHT)로 나간 마지막 LAND
  const lastLand = x.clearances
    .filter((c) => c.type === "LAND" && !c.cancelledAt && c.at >= p.createdAt && ((p.standPath && c.stand === p.standPath) || (!c.stand && p.ticketKey && c.flight === p.ticketKey)))
    .at(-1);
  const ga = goAroundOf(p, { clearances: x.clearances, events: x.events, pulls: s.pulls, lastLand, holders, now: x.now });
  if (ga && ga.action === "supervisor" && ga.why === "no-holder") return { type: "GO AROUND", text: ga.text, reason: ga.reason };
  // GO AROUND가 나가면(action sent) 남은 FIX가 다음 카드가 된다
  const fx = fixOf(p, { clearances: x.clearances, holders, now: x.now });
  return fx && fx.action === "supervisor" && fx.why === "no-holder" ? { type: "FIX", text: fx.text, reason: fx.source } : null;
}

export function relayOffersOf(s: OfferSnapshot, x: OfferInput): RelayOffer[] {
  const out: RelayOffer[] = [];
  const wsByPath = new Map(s.workspaces.map((w) => [w.path, w]));
  for (const p of s.pulls.filter(inSequence)) {
    const pick = noHolderPickOf(p, s, x);
    if (!pick || taken(x.relays, pick.type, p.number, p.head.slice(0, 7))) continue;
    const route = x.holderRoutes?.get(offerKey(p, pick.type));
    if (x.holderRoutes !== undefined && route?.kind !== "relay") continue; // 아직 계산 전이거나 AIRCRAFT·DUTY가 맡는다
    const ws = p.standPath ? wsByPath.get(p.standPath) : undefined;
    out.push({
      key: offerKey(p, pick.type),
      type: pick.type,
      repo: p.repo,
      pr: p.number,
      head: p.head.slice(0, 7),
      flight: p.ticketKey ?? null,
      airport: s.airports.find((a) => a.repo === p.repo)?.code ?? null,
      stand: p.standPath ?? null,
      standName: ws?.name ?? (p.standPath ? (p.standPath.split("/").pop() ?? null) : null),
      text: pick.text,
      to: lastAircraftOf(p.ticketKey ?? null, x.lastAircraft),
      reason: pick.reason,
      noHolder: route?.why ?? null,
    });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}
