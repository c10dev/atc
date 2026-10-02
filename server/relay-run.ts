import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { accountFolders, folderOfAccount } from "./accounts.ts";
import { causeOf } from "./address.ts";
import { allClearances } from "./clearances.ts";
import { config } from "./config.ts";
import { loadFleet } from "./fleet.ts";
import type { Snapshot } from "./model.ts";
import { fromThisApp } from "./origin.ts";
import { bustQueue } from "./queue-bust.ts";
import { record } from "./recorder.ts";
import { readReports } from "./arrival-report.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import { readDepartures } from "./departures.ts";
import { allProposals } from "./proposals.ts";
import { registrationOf } from "./registration.ts";
import { clearanceTypeOf, foldRelays, type LastAircraftInput, liveSessionOf, nextRelayId, type Relay, type RelayOp, relayInputOf, unreachableWhy } from "./relay.ts";

// SUPERVISOR RELAY(ATC-271)의 쓰기·읽기. 계산은 relay.ts(순수). 추가만 하는 relays.jsonl(create → issued → undeliverable | hand)을 접어 상태를 만든다.
// 만드는 길은 이 화면의 클릭뿐이다(fromThisApp, 아니면 403). atcctl에는 만드는 명령이 없고, TOWER는 issued·undeliverable만 표시한다.
const FILE = () => join(config.stateDir, "relays.jsonl");

export function readRelayOps(file = FILE()): RelayOp[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const ops: RelayOp[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      ops.push(JSON.parse(line));
    } catch {}
  }
  return ops;
}

export function append(op: RelayOp, file = FILE()) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(op) + "\n");
  bustQueue(); // 손으로 전하는 카드가 곧바로 뜨고 사라진다
}

export const allRelays = (): Relay[] => foldRelays(readRelayOps(), allClearances());

// 그 FLIGHT를 난 AIRCRAFT를 찾는 자료(lastAircraftOf): DEPARTURE LOG, 제안, ARRIVED 보고
export function lastAircraftSources(): LastAircraftInput {
  const teamPattern = loadDispatchConfig().teamPattern;
  return { departures: readDepartures(), proposals: allProposals(), reports: readReports(), regOf: (n) => registrationOf(n, teamPattern) };
}

const DAY = 86_400_000;
// 화면용: 아직 닫히지 않았거나(queued·issued·undeliverable) 하루 안에 닫힌 것
export const recentRelays = (now = Date.now()) => allRelays().filter((r) => r.status === "queued" || r.status === "issued" || r.status === "undeliverable" || now - Date.parse(r.statusAt) < DAY);

export function mountRelay(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  app.get("/api/relay", (c) => c.json({ relays: recentRelays() }));

  // SUPERVISOR가 화면에서 보낸다. 닿지 못할 줄 알면 만들면서 바로 undeliverable로 둔다(조용히 취소하지 않고 손으로 전하는 카드가 뜬다)
  app.post("/api/relay", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다(SUPERVISOR 전용)" }, 403);
    const input = relayInputOf(await c.req.json().catch(() => null));
    if ("error" in input) return c.json(input, 400);
    const s = await getSnapshot();
    const fleet = loadFleet();
    const known = new Set([...Object.keys(fleet.aircraft), ...s.sessions.map((x) => x.name)].map((n) => n.toUpperCase()));
    if (!known.has(input.to.toUpperCase())) return c.json({ error: `${input.to}는 알려진 AIRCRAFT가 아님` }, 400);
    // GO AROUND·FIX RELAY(ATC-308)의 STAND: 아는 워크스페이스(경로나 이름)만 받아 경로로 저장한다
    if (input.stand) {
      const ws = s.workspaces.find((w) => w.path === input.stand || w.name === input.stand);
      if (!ws) return c.json({ error: `${input.stand}는 알려진 STAND가 아님` }, 400);
      input.stand = ws.path;
    }
    const at = new Date().toISOString();
    const ops = readRelayOps();
    const id = nextRelayId(ops);
    const target = liveSessionOf(s.sessions, input.to);
    const tower = liveSessionOf(s.sessions, "TOWER");
    append({ op: "create", id, at, ...input, ...(target ? { toSessionId: target.id, ...(target.jobId ? { toJobId: target.jobId } : {}), ...(target.account ? { toAccount: target.account } : {}) } : {}) });
    record({ t: at, kind: "relay", op: "create", id, by: "supervisor", to: input.to, relayKind: input.kind, flight: input.flight, ...(input.type ? { type: input.type, stand: input.stand ?? null } : {}) });
    const why = unreachableWhy(target, tower);
    if (why) {
      append({ op: "undeliverable", id, at, reason: why, cause: causeOf(why) });
      record({ t: at, kind: "relay", op: "undeliverable", id, by: "atc", reason: why });
    }
    return c.json({ relay: allRelays().find((r) => r.id === id) });
  });

  // TOWER가 CLEARANCE로 보낸 뒤 표시한다(atcctl relay issued R-0001 C-0300). relay에 맞는 받는 이의 CLEARANCE만 받는다
  app.post("/api/relay/:id/issued", async (c) => {
    const id = c.req.param("id").toUpperCase();
    const body = await c.req.json().catch(() => ({}));
    const r = allRelays().find((x) => x.id === id);
    if (!r) return c.json({ error: "그런 relay가 없음" }, 404);
    if (r.status !== "queued") return c.json({ error: `${id}는 이미 ${r.status}` }, 409);
    const clearance = typeof body.clearance === "string" ? body.clearance.toUpperCase() : "";
    const cl = allClearances().find((x) => x.id === clearance);
    if (!cl) return c.json({ error: "clearance(C-xxxx)가 필요함 — 먼저 atcctl issue로 보낸다" }, 400);
    if (cl.toName.toUpperCase() !== r.to.toUpperCase()) return c.json({ error: `${clearance}는 ${cl.toName}에게 간 CLEARANCE라 ${r.to}의 relay가 아님` }, 409);
    // STAND에 묶은 relay(ATC-308)는 그 type·STAND로 나간 CLEARANCE여야 goAroundSent·fixSent가 보낸 것으로 읽는다
    if (r.type && cl.type !== clearanceTypeOf(r)) return c.json({ error: `${clearance}는 ${cl.type} CLEARANCE라 ${r.type} relay가 아님` }, 409);
    if (r.stand && cl.stand !== r.stand) return c.json({ error: `${clearance}의 STAND(${cl.stand ?? "없음"})가 relay의 STAND(${r.stand})와 다름 — atcctl issue에 --stand를 준다` }, 409);
    if (cl.text !== r.text) return c.json({ error: `${clearance}의 본문이 relay와 다름 — relay는 고치지 않고 그대로 보낸다` }, 409);
    const at = new Date().toISOString();
    append({ op: "issued", id, at, clearance });
    record({ t: at, kind: "relay", op: "issued", id, by: "TOWER", clearance });
    return c.json({ relay: allRelays().find((x) => x.id === id) });
  });

  // 닿지 못했다(TOWER가 SendMessage 실패를 알림). 사유 필요. queued·issued만
  app.post("/api/relay/:id/undeliverable", async (c) => {
    const id = c.req.param("id").toUpperCase();
    const body = await c.req.json().catch(() => ({}));
    const r = allRelays().find((x) => x.id === id);
    if (!r) return c.json({ error: "그런 relay가 없음" }, 404);
    if (r.status !== "queued" && r.status !== "issued") return c.json({ error: `${id}는 이미 ${r.status}` }, 409);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) return c.json({ error: "undeliverable에는 사유(reason)가 필요함" }, 400);
    if (reason.length > 300) return c.json({ error: "사유는 300자 이내" }, 400);
    const at = new Date().toISOString();
    append({ op: "undeliverable", id, at, reason, cause: causeOf(reason, typeof body.cause === "string" ? body.cause : null) });
    record({ t: at, kind: "relay", op: "undeliverable", id, by: "TOWER", reason });
    return c.json({ relay: allRelays().find((x) => x.id === id) });
  });

  // SUPERVISOR가 손으로 전했다고 표시한다(카드를 닫는다). 화면에서만
  app.post("/api/relay/:id/hand", (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다(SUPERVISOR 전용)" }, 403);
    const id = c.req.param("id").toUpperCase();
    const r = allRelays().find((x) => x.id === id);
    if (!r) return c.json({ error: "그런 relay가 없음" }, 404);
    if (r.status !== "undeliverable") return c.json({ error: `${id}는 ${r.status} — 손으로 전할 것은 undeliverable뿐` }, 409);
    const at = new Date().toISOString();
    append({ op: "hand", id, at });
    record({ t: at, kind: "relay", op: "hand", id, by: "supervisor" });
    return c.json({ relay: allRelays().find((x) => x.id === id) });
  });
}

// 손으로 전하는 카드가 쓰는 폴더 정보(ACCOUNT 라벨 → 폴더). 등록부에 없으면 null
export function folderDirOf(account: string | undefined | null): string | null {
  return folderOfAccount(account, accountFolders())?.dir ?? null;
}
