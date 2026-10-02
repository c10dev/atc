import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { callsign, flightNumber } from "./callsign.ts";
import { awayOperations } from "./away.ts";
import { allClearances, CLEARANCE_TYPES, isClearanceOverdue, isPending, issueClearance, markClearance, markClearanceHand } from "./clearances.ts";
import { fromThisApp } from "./origin.ts";
import { bustQueue } from "./queue-bust.ts";
import { type Relay, relayBriefOf } from "./relay.ts";
import { allRelays } from "./relay-run.ts";
import { config } from "./config.ts";
import type { EventLog } from "./events.ts";
import { type AtfmConfig, DEFAULT_ATFM, enforcedStops, landOf, loadAtfm, slotHoldOf, slotLimitOf, slotsOf } from "./atfm.ts";
import { healthLabel } from "./health.ts";
import { codexWhyEn, infoTextOf } from "./landing-en.ts";
import { fuelInfos } from "./fuel-remaining.ts";
import type { FuelWatch } from "./fuel-watch.ts";
import { fixOf, infoOf } from "./fix.ts";
import { goAroundOf } from "./go-around.ts";
import { type LandBy, landByOf, type MccLandInfo } from "./land-by.ts";
import { inSequence, pullKey, reviewerOf } from "./landing.ts";
import { record } from "./recorder.ts";
import { closingLine, responseOf } from "./response.ts";
import type { Clearance, ClearanceType, Session, Snapshot, TrafficEvent } from "./model.ts";

// CONTROLLER(1단계, 조언 모드)가 쓰는 API. atc는 판단하지 않고, 브리핑을 주고 CLEARANCE·READBACK을 기록만 한다.

const OVERDUE_MS = 10 * 60_000;

function sessionLabel(s: Session | undefined, id: string) {
  return s
    ? { id: s.id, name: s.name, callsign: callsign(s), status: s.status }
    : { id, name: id.slice(0, 8), callsign: id.slice(0, 8), status: "dead" as const };
}

// CLEARED PR에 줄 LAND 문구(영어, ATC-126). TOWER는 이 글을 그대로 `atcctl issue … LAND -- <landText>`로 보낸다.
// 순서(repoSeq)와 앞 PR은 같은 저장소·base의 CLEARED PR 안에서만 센다 — 다른 저장소의 머지는 rebase가 필요 없다.
// 첫 번째는 지금 LANDING 가능, 그 뒤는 바로 앞 PR 머지 뒤 rebase. AIRPORT·FLIGHT가 없으면 괄호를 뺀다.
// p3: 해결·답글된 Codex P3 지적이 남은 채 CLEARED인 PR(ATC-28). 막지는 않지만 LAND 글에 남긴다
export function landTextOf(repoSeq: number, airport: string | null, pr: number, flight: string | null, prevPr: number | null, p3 = 0): string {
  const head = `LANDING sequence ${repoSeq}${airport ? ` (${airport})` : ""}: PR #${pr}${flight ? ` (${flight})` : ""}.`;
  const note = p3 ? ` Codex P3 findings left: ${p3}. They are resolved or answered. They do not block landing.` : "";
  if (prevPr == null) return `${head} Clear to LAND now. Check that base is current before you merge.${note}`;
  return `${head} Rebase and LAND after the PR ahead (#${prevPr}) merges.${note}`;
}

export function buildBrief(
  s: Snapshot,
  since: { events: TrafficEvent[]; reset: boolean; cursor: string },
  clearances: Clearance[],
  now = Date.now(),
  atfm: AtfmConfig = DEFAULT_ATFM,
  fuel: FuelWatch | null = null,
  mcc: MccLandInfo | null = null, // MCC AIRPORT의 모드·HOLD·ESCALATE·등급(ATC-151). 없으면 모든 AIRPORT가 holder
  relays: readonly Relay[] = [], // SUPERVISOR RELAY(ATC-271): 보내지 않은(queued) 것만 brief에 실린다
) {
  const sessionById = new Map(s.sessions.map((x) => [x.id, x]));
  const label = (id: string) => sessionLabel(sessionById.get(id), id);
  const wsByPath = new Map(s.workspaces.map((w) => [w.path, w]));
  const standName = (path?: string | null) => (path ? (wsByPath.get(path)?.name ?? path.split("/").pop()) : undefined);
  const flight = (key?: string | null) => (key ? flightNumber(key) : undefined);
  const active = s.claims.filter((c) => c.state === "active");
  const codeOf = (repo: string | null | undefined) =>
    repo ? (s.airports.find((a) => a.repo === repo)?.code ?? repo.split("/").pop()) : undefined;
  const away = awayOperations(s);

  const pending = clearances.filter(isPending);
  const clearanceView = (c: Clearance) => ({
    id: c.id,
    to: label(c.to),
    type: c.type,
    stand: standName(c.stand),
    flight: flight(c.flight),
    text: c.text,
    response: responseOf("clearance", c.type), // 닫는 답(ATC-122): W/U는 READBACK·UNABLE, R은 ROGER
    standbyAt: c.standbyAt ?? null,
    ageMin: Math.round((now - Date.parse(c.at)) / 60_000),
  });

  // LANDING SEQUENCE: Draft가 아닌 열린 PR. CLEARED TO LAND가 readyAt 순으로 앞(seq 1, 2, …), 그 뒤 APPROACH.
  const sequence = s.pulls.filter(inSequence);
  // ATFM: 켜진 출발 중지(그 AIRPORT에는 LAND를 내지 않는다)와 머지 슬롯(slots가 on이면 waiting-slot PR에 slotHold)
  const stopped = enforcedStops(s.atfm?.groundStops ?? [], "land"); // LAND를 막는 것만(LOS는 ASSIGN만 막는다, ATC-62)
  const mainOf = new Map((s.atfm?.mains ?? []).map((m) => [m.repo, m]));
  const priorityOf = new Map(s.tickets.map((t) => [t.key, t.priority]));
  const slots =
    atfm.slots === "off"
      ? new Map()
      : slotsOf(s.pulls, {
          limitOf: (repo) => slotLimitOf(codeOf(repo) ?? null, mainOf.get(repo), atfm),
          priorityOf: (k) => (k ? (priorityOf.get(k) ?? 0) : 0),
          landOf: (p) => landOf(p, clearances),
          now,
        });
  const cleared = sequence.filter((x) => x.landing === "CLEARED");
  const landingQueue = sequence.map((p) => {
    const stand = p.standPath ? wsByPath.get(p.standPath) : undefined;
    // 이 PR을 연 뒤 같은 STAND(없으면 같은 FLIGHT)로 나간 LAND
    const lastLand = clearances
      .filter(
        (c) =>
          c.type === "LAND" &&
          !c.cancelledAt &&
          c.at >= p.createdAt &&
          ((p.standPath && c.stand === p.standPath) || (!c.stand && p.ticketKey && c.flight === p.ticketKey)),
      )
      .at(-1);
    const seq = p.landing === "CLEARED" ? cleared.indexOf(p) + 1 : null;
    const fl = flight(p.ticketKey) ?? null;
    // 같은 저장소·base의 CLEARED 안에서의 순서와 바로 앞 PR
    const lane = cleared.filter((x) => x.repo === p.repo && x.base === p.base);
    const repoSeq = seq ? lane.indexOf(p) + 1 : null;
    const airport = codeOf(p.repo) ?? null;
    // 누가 착륙시키나(ATC-151). holder가 아니면 TOWER는 팀에 LAND를 내지 않는다. 순서(repoSeq)는 MCC에도 뜻이 있어 그대로 둔다
    const holderCount = p.standPath ? active.filter((c) => c.workspacePath === p.standPath).length : 0;
    const infoText = infoTextOf(p.number, p.blocks.filter((b) => !b.findings).map((b) => b.en));
    const landBy: LandBy = landByOf(p, mcc, s.airports.find((a) => a.repo === p.repo)?.teamsMerge !== false);
    return {
      seq,
      landing: p.landing,
      flight: fl,
      key: p.ticketKey,
      airport: codeOf(p.repo),
      pr: { number: p.number, url: p.url, title: p.title, branch: p.branch, head: p.head.slice(0, 7) },
      stand: stand?.name ?? null,
      holders: p.standPath ? active.filter((c) => c.workspacePath === p.standPath).map((c) => label(c.sessionId)) : [],
      blocks: p.blocks,
      // APPROACH에서 TOWER가 holders에게 INFO 본문으로 그대로 쓴다(영어, ATC-174). blocks[].text는 화면용 한국어라 팀에 보내지 않는다.
      // 리뷰 지적(review-findings)은 FIX가 맡아서 여기서 뺀다(ATC-270)
      infoText: p.landing === "APPROACH" ? infoText : null,
      // 막힘 INFO를 보낼지(ATC-270): 마지막 INFO 본문과 비교해 상태로 정한다. 서버가 재시작돼 이벤트가 없어도(reset) 같다
      info: infoOf(p, { clearances, holders: holderCount }),
      // 리뷰 지적(MCC INSPECTION·REVIEW·Codex·이어받은 리뷰)을 고치라는 지시(ATC-270). action "send"면 TOWER가 holders에게 FIX로 text 그대로 보낸다
      fix: fixOf(p, { clearances, holders: holderCount, now }),
      readyAt: p.readyAt,
      // CODEX UNAVAILABLE(ATC-7·27): Codex 한도·무응답이면 착륙 리뷰 상태. review는 착륙 리뷰 통과로 CLEARED일 때 리뷰어("SONNET" → "REVIEW: SONNET (Codex 한도)")
      codex: p.codexUnavailable ? { ...p.codexUnavailable, label: codexWhyEn(p.codexUnavailable.why, Math.round(config.codexSilentMs / 3_600_000), p.codexUnavailable.scope ? p.codexUnavailable.since : null) } : null,
      extReview: p.extReview ? { status: p.extReview.status, reason: p.extReview.reason, security: p.extReview.security ?? null, family: p.extReview.review?.family ?? null, at: p.extReview.review?.at ?? null } : null,
      review: p.landing === "CLEARED" && p.extReview?.status === "pass" && p.extReview.review ? reviewerOf(p.extReview.review.family) : null,
      landClearance: lastLand ? { id: lastLand.id, readBack: Boolean(lastLand.readbackAt) } : null,
      // CLEARED에만. TOWER가 LAND CLEARANCE 본문으로 그대로 쓴다(landText는 landBy가 holder일 때만)
      repoSeq,
      landBy,
      // PR이 base와 충돌·뒤처졌거나 LAND 문구의 앞 PR이 머지됨(ATC-128). action "send"면 TOWER가 holders에게 GO AROUND로 text 그대로 보낸다
      goAround: goAroundOf(p, { clearances, events: since.events, pulls: s.pulls, lastLand, holders: holderCount, now }),
      landText: repoSeq && landBy === "holder" ? landTextOf(repoSeq, airport, p.number, fl, repoSeq > 1 ? lane[repoSeq - 2].number : null, p.codexFindings?.ok ? p.codexFindings.p3 : 0) : null,
      // 쌓인 PR(base가 기본 브랜치가 아님, ATC-29): CLEARED가 되지 않고 LAND를 내지 않는다. stack.chain은 아래부터
      stacked: p.blocks.some((b) => b.code === "stacked"),
      // 이어받은 리뷰(ATC-31): main 병합만 한 head에 이전 커밋 R의 리뷰. findings면 지적으로 막는다
      // AUTOLAND AIRPORT의 머지 리뷰(ATC-328): 누가 남겼고 판정이 무엇인지. 이 head에 기록이 없으면 null
      mergeReview: p.mergeReview ? { by: p.mergeReview.by, verdict: p.mergeReview.verdict, p0: p.mergeReview.p0, p1: p.mergeReview.p1, p2: p.mergeReview.p2, carriedFrom: p.mergeReview.carriedFrom?.slice(0, 7) ?? null } : null,
      carried: p.carried ? { from: p.carried.from.slice(0, 7), by: p.carried.by, findings: p.carried.findings } : null,
      stack: p.stack ?? null,
      // 현재 head의 Codex 인라인 지적(등급별 수, ok면 P3만·모두 해결·답글이라 착륙을 막지 않음). 없으면 null(ATC-28)
      codexFindings: p.codexFindings ?? null,
      // 켜진 GROUND STOP이 이 AIRPORT에 걸려 있으면 LAND를 내지 않는다
      groundStop: airport && stopped.has(airport) ? { trigger: stopped.get(airport)!.trigger, text: stopped.get(airport)!.text, since: stopped.get(airport)!.since } : null,
      // 머지 슬롯. slotHold가 있으면(slots "on"이고 waiting-slot) TOWER는 LAND를 내지 않는다. 그림자면 slot은 참고만
      slot: slots.get(pullKey(p)) ?? null,
      slotHold: slotHoldOf(slots.get(pullKey(p)), atfm.slots),
    };
  });

  const traffic = s.sessions
    .filter((x) => x.status !== "dead" && active.some((c) => c.sessionId === x.id))
    .map((x) => ({
      ...label(x.id),
      home: codeOf(x.repo),
      away: (away.get(x.id) ?? []).map(codeOf),
      stands: active
        .filter((c) => c.sessionId === x.id)
        .map((c) => ({
          stand: standName(c.workspacePath),
          standPath: c.workspacePath,
          airport: codeOf(wsByPath.get(c.workspacePath)?.repo),
          flight: flight(wsByPath.get(c.workspacePath)?.ticketKey),
          source: c.source,
          since: c.since,
          lastAt: c.lastAt,
        })),
    }));

  const alertsOf = (kind: string) => s.alerts.filter((a) => a.kind === kind);
  return {
    at: new Date(now).toISOString(),
    cursor: since.cursor,
    reset: since.reset,
    events: since.events.map((e) => ({
      id: e.id,
      at: e.at,
      kind: e.kind,
      alert: e.alertKind,
      stand: standName(e.workspacePath),
      flight: flight(e.ticketKey),
      sessions: e.sessionIds?.map(label),
      airport: codeOf(e.repo),
      pr: e.pull,
      blocks: e.blocks,
      head: e.head,
      merged: e.merged,
      shared: e.shared,
      message: e.message,
    })),
    open: {
      conflicts: alertsOf("conflict").map((a) => ({
        stand: standName(a.workspacePath),
        standPath: a.workspacePath,
        // since가 이른 쪽이 먼저 들어온 AIRCRAFT
        sessions: active
          .filter((c) => c.workspacePath === a.workspacePath && a.sessionIds?.includes(c.sessionId))
          .sort((x, y) => x.since.localeCompare(y.since))
          .map((c) => ({ ...label(c.sessionId), since: c.since, lastAt: c.lastAt })),
      })),
      orphans: alertsOf("orphan").map((a) => ({ stand: standName(a.workspacePath), sessions: a.sessionIds?.map(label) })),
      unattended: alertsOf("unattended").map((a) => ({ stand: standName(a.workspacePath), message: a.message })),
      noContact: alertsOf("no-workspace").map((a) => flight(a.ticketKey)),
      // AIRCRAFT health(ATC-45): 멈췄거나 기다리는 AIRCRAFT. TOWER는 ALERT를 SUPERVISOR에게 보고한다(다시 보내지는 않는다)
      health: s.sessions
        .filter((x) => x.status !== "dead" && x.health)
        .map((x) => ({ ...label(x.id), code: x.health!.code, level: x.health!.level, text: healthLabel(x.health!, now), since: x.health!.since, resetsAt: x.health!.resetsAt ?? null, detail: x.health!.detail, next: x.health!.next })),
      healthAlerts: alertsOf("health").map((a) => ({ message: a.message, sessions: a.sessionIds?.map(label) })),
      // FUEL REMAINING(ATC-55): INFO 임계값을 넘은 ACCOUNT(모르면 AIRCRAFT)마다 하나. key가 같으면 이미 알린 것
      fuel: fuelInfos(s.fuelAccounts ?? s.fuel ?? {}, now),
      // FUEL F8(ATC-56): 24시간 안 큰 LEAK(팀 AIRCRAFT마다, key는 AIRCRAFT·날짜)과, 지금 보내면 캐시가 식어 있는 HOLDING CAPTAIN.
      // 경고만 한다 — CLEARANCE를 막지 않는다. 대화 기록을 읽지 못했으면 fuelError
      fuelLeaks: fuel?.largeLeaks ?? [],
      coldCache: fuel?.coldCache ?? [],
      fuelError: fuel?.error ?? null,
      // STRANDED(ATC-29): 기본 브랜치에 닿지 않은 머지. Linear Done이어도 남는다
      stranded: (s.stranded ?? []).map((x) => ({ flight: flight(x.flight), key: x.flight, pr: x.number, url: x.url, base: x.base, mergedAt: x.mergedAt, message: alertsOf("stranded").find((a) => a.ticketKey === x.flight)?.message ?? null })),
    },
    landingQueue,
    // SUPERVISOR가 화면에서 AIRCRAFT에게 보낸 글(ATC-271). TOWER는 text를 고치지 않고 type의 CLEARANCE로 그대로 보낸 뒤 `atcctl relay issued`로 표시한다
    relays: relayBriefOf(relays, now),
    // ATFM 출발 중지. enforced만 실제로 막는다(나머지는 그림자)
    groundStops: (s.atfm?.groundStops ?? []).map((g) => ({ airport: g.airport, trigger: g.trigger, kind: g.kind, enforced: g.enforced, text: g.text, since: g.since })),
    github: s.github,
    clearances: {
      pending: pending.map(clearanceView),
      overdue: pending.filter((c) => isClearanceOverdue(c, now, OVERDUE_MS)).map((c) => c.id), // 첫 STANDBY가 있으면 그때부터 다시 센다
    },
    traffic,
  };
}

export function formatClearance(c: Clearance, s: Snapshot): string {
  const target = s.sessions.find((x) => x.id === c.to);
  const who = target ? `${callsign(target)}${callsign(target) !== target.name ? ` (${target.name})` : ""}` : c.toName;
  const stand = c.stand ? (s.workspaces.find((w) => w.path === c.stand)?.name ?? c.stand) : null;
  const where = [stand && `STAND ${stand}`, c.flight && `FLIGHT ${flightNumber(c.flight)}`].filter(Boolean).join(" · ");
  return [
    `[ATC ${c.id}] ${who} · ${c.type}`,
    where,
    c.text,
    closingLine("clearance", responseOf("clearance", c.type), c.id),
  ]
    .filter(Boolean)
    .join("\n");
}

// 이름 또는 ID로 살아 있는 세션 하나를 찾는다. 이름이 겹치면 모호하다고 거절한다.
export function resolveSession(s: Snapshot, to: string): Session | string {
  const byId = s.sessions.find((x) => x.id === to);
  if (byId) return byId;
  const byName = s.sessions.filter((x) => x.status !== "dead" && (x.name === to || callsign(x) === to.toUpperCase()));
  if (byName.length === 1) return byName[0];
  return byName.length ? `"${to}" 이름의 세션이 ${byName.length}개라 ID로 지정해야 함` : `"${to}" 세션을 찾을 수 없음`;
}

function resolveStand(s: Snapshot, stand: string | undefined): string | null | { error: string } {
  if (!stand) return null;
  const ws = s.workspaces.find((w) => w.path === stand || w.name === stand);
  return ws ? ws.path : { error: `"${stand}" STAND(워크트리)를 찾을 수 없음` };
}

function normalizeFlight(flight: string | undefined): string | null {
  if (!flight) return null;
  const m = flight.toUpperCase().match(/^([A-Z][A-Z0-9]*?)-?(\d+)$/);
  return m ? `${m[1]}-${Number(m[2])}` : flight;
}

const consumerFile = (name: string) => join(config.stateDir, "consumers", `${name}.json`);

export function readCursor(name: string): string | null {
  try {
    return JSON.parse(readFileSync(consumerFile(name), "utf8")).cursor ?? null;
  } catch {
    return null;
  }
}

function writeCursor(name: string, cursor: string) {
  mkdirSync(join(config.stateDir, "consumers"), { recursive: true });
  writeFileSync(consumerFile(name), JSON.stringify({ cursor, at: new Date().toISOString() }) + "\n");
}

// watchFuel: FUEL 경고(fuel-watch.ts). fuel-run.ts를 거쳐 순환이 되므로 index.ts가 넘긴다
// mccInfo: MCC AIRPORT의 landBy 자료(mcc-run.ts). mcc-run.ts를 거쳐 순환이 되므로 index.ts가 넘긴다
export function mountController(app: Hono, getSnapshot: () => Promise<Snapshot>, log: EventLog, watchFuel?: (s: Snapshot) => FuelWatch, mccInfo?: (s: Snapshot) => Promise<MccLandInfo | null>) {
  const consumerOf = (v: string | undefined) => (v && /^[\w-]+$/.test(v) ? v : "controller");

  app.get("/api/controller/brief", async (c) => {
    const consumer = consumerOf(c.req.query("consumer"));
    const since = log.since(c.req.query("cursor") ?? readCursor(consumer));
    const s = await getSnapshot();
    const mcc = await (mccInfo?.(s) ?? Promise.resolve(null)).catch(() => null); // 예상 못 한 오류면 옛 흐름(holder)으로. 등급을 못 읽은 것은 mccInfo가 tiers에서 빼서 supervisor가 된다
    return c.json(buildBrief(s, since, allClearances(), Date.now(), loadAtfm(), watchFuel?.(s) ?? null, mcc, allRelays()));
  });

  app.post("/api/controller/ack", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.cursor !== "string") return c.json({ error: "cursor가 필요함" }, 400);
    writeCursor(consumerOf(body.consumer), body.cursor);
    record({ t: new Date().toISOString(), kind: "ack", consumer: consumerOf(body.consumer) });
    return c.json({ ok: true, cursor: body.cursor });
  });

  app.post("/api/clearances", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const s = await getSnapshot();
    if (!CLEARANCE_TYPES.includes(body.type)) return c.json({ error: `type은 ${CLEARANCE_TYPES.join("|")} 중 하나` }, 400);
    if (typeof body.text !== "string" || !body.text.trim()) return c.json({ error: "text가 필요함" }, 400);
    const target = resolveSession(s, String(body.to ?? ""));
    if (typeof target === "string") return c.json({ error: target }, 400);
    const stand = resolveStand(s, body.stand);
    if (stand && typeof stand === "object") return c.json(stand, 400);
    const clearance = issueClearance({
      to: target.id,
      toName: target.name,
      type: body.type as ClearanceType,
      stand,
      flight: normalizeFlight(body.flight),
      text: body.text.trim(),
    });
    return c.json({ clearance, sendTo: target.name, message: formatClearance(clearance, s) });
  });

  // CAPTAIN의 답을 TOWER가 기록한다(ATC-122). unable은 본문에 reason. 이 메시지에 받을 수 없는 답이면 409
  for (const op of ["readback", "roger", "unable", "standby", "cancel", "undeliverable"] as const) {
    app.post(`/api/clearances/:id/${op}`, async (c) => {
      const body = op === "unable" || op === "undeliverable" ? await c.req.json().catch(() => ({})) : {};
      const r = markClearance(c.req.param("id").toUpperCase(), op, typeof body.reason === "string" ? body.reason : undefined);
      if (!r) return c.json({ error: "그런 CLEARANCE가 없음" }, 404);
      if (!("error" in r) && op === "undeliverable") bustQueue();
      return "error" in r ? c.json(r, 409) : c.json({ clearance: r });
    });
  }

  // SUPERVISOR가 닿지 못한 CLEARANCE를 손으로 전했다고 표시한다(ATC-271). 화면에서만(atcctl은 Origin이 없다)
  app.post("/api/clearances/:id/hand", (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다(SUPERVISOR 전용)" }, 403);
    const r = markClearanceHand(c.req.param("id").toUpperCase());
    if (!r) return c.json({ error: "그런 CLEARANCE가 없음" }, 404);
    if (!("error" in r)) bustQueue();
    return "error" in r ? c.json(r, 409) : c.json({ clearance: r });
  });
}
