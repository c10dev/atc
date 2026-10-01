import { createHash } from "node:crypto";

// SQUELCH(docs/squelch.md): 관제 세션의 `/loop` `/tick` 앞에서, 그 세션이 다루는 것이 지난 통과 뒤 바뀌었는지 본다.
// 여기는 순수 함수만 둔다(입출력은 squelch-run.ts). 세션을 판단하지 않는다 — 통과시킬지 버릴지만 고른다.

export const ROLES = ["tower", "mcc", "occ", "crosscheck", "review"] as const;
export type Role = (typeof ROLES)[number];
export const isRole = (x: string): x is Role => (ROLES as readonly string[]).includes(x);

export type Mode = "off" | "shadow" | "on";
export const MODES: readonly Mode[] = ["off", "shadow", "on"];
// 지문 버전(ATC-297): v1은 지금 쓰는 것, v2는 후보. 역할마다 고르고 기본은 v1. v2는 v1 옆에서 그림자로 같이 돈다
export type Fingerprint = "v1" | "v2";
export const FINGERPRINTS: readonly Fingerprint[] = ["v1", "v2"];
export const DEFAULT_HEARTBEAT_MIN = 50; // 1시간 캐시가 식기 전에 한 번(docs/squelch.md 5장)

// 응답 본문(brief JSON)은 서버가 이미 만든 모양 그대로 들어온다. 필드가 빠져도 죽지 않게 느슨하게 읽는다.
type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const arr = (x: J): J[] => (Array.isArray(x) ? x : []);
const ids = (x: J, key = "id"): string[] => arr(x).map((i) => String(i?.[key])).sort();
const blockCodes = (blocks: J): string[] => arr(blocks).map((b) => (typeof b === "string" ? b.split(" ")[0] : String(b?.code)));

export interface Inputs {
  brief?: J; // tower: GET /api/controller/brief
  queue?: J; // mcc: GET /api/mcc/queue
  dispatch?: J; // occ·crosscheck: GET /api/dispatch/brief
  crewChange?: J; // occ: GET /api/fleet/crew-changes/brief
  schedule?: J; // occ·crosscheck: GET /api/schedule/brief
  following?: J; // occ: GET /api/following
  reviews?: J; // review: GET /api/landing/reviews
}

// 시각·나이·움직이는 커서는 뺀다(`generatedAt`, `at`, `ageMin`, …). 시간이 만드는 신호는 브리핑이 이미 세운 필드로 센다:
// clearances.overdue, slotHold, overdue, slips[].fresh, following의 fresh
function projectTower(b: J) {
  return {
    reset: Boolean(b?.reset),
    // 이벤트는 ack 전이라 남아 있으면 늘 센다. 새 이벤트는 id가 다르다
    events: ids(b?.events),
    landingQueue: arr(b?.landingQueue)
      .map((q) => ({
        airport: q.airport ?? null,
        pr: q.pr?.number ?? null,
        head: q.pr?.head ?? null,
        landing: q.landing ?? null,
        blocks: blockCodes(q.blocks),
        slotHold: Boolean(q.slotHold),
        groundStop: Boolean(q.groundStop),
        codex: q.codex ?? null,
        ext: q.extReview ? { status: q.extReview.status ?? null, family: q.extReview.family ?? null } : null,
        review: q.review ?? null,
        landClearance: q.landClearance ? { id: q.landClearance.id, readBack: Boolean(q.landClearance.readBack) } : null,
        holders: arr(q.holders).map((h) => h?.name ?? h).sort(),
      }))
      .sort((x, y) => `${x.airport}#${x.pr}`.localeCompare(`${y.airport}#${y.pr}`)),
    // CLEARANCE나 보고가 필요한 열린 것
    open: {
      conflicts: arr(b?.open?.conflicts).map((c) => ({ stand: c.stand ?? null, sessions: arr(c.sessions).map((s) => s?.name ?? s).sort() })),
      orphans: arr(b?.open?.orphans).map((o) => ({ stand: o.stand ?? null, sessions: arr(o.sessions).map((s) => s?.name ?? s).sort() })),
      unattended: arr(b?.open?.unattended).map((u) => ({ stand: u.stand ?? null, message: u.message ?? null })),
      noContact: arr(b?.open?.noContact).map(String),
      health: arr(b?.open?.health).map((h) => ({ name: h.name ?? null, code: h.code, level: h.level, since: h.since ?? null })),
      healthAlerts: arr(b?.open?.healthAlerts).map((h) => h?.message ?? null),
      fuel: ids(b?.open?.fuel, "key"),
      fuelLeaks: ids(b?.open?.fuelLeaks, "key"),
      coldCache: arr(b?.open?.coldCache).map((c) => c?.name ?? c?.aircraft ?? JSON.stringify(c)).sort(),
      stranded: arr(b?.open?.stranded).map((x) => `${x.key}#${x.pr}`).sort(),
    },
    groundStops: arr(b?.groundStops).map((g) => ({ airport: g.airport, trigger: g.trigger, enforced: Boolean(g.enforced) })),
    clearances: { pending: ids(b?.clearances?.pending), overdue: arr(b?.clearances?.overdue).map(String).sort() },
  };
}

function projectMcc(q: J) {
  return {
    mode: q?.mode ?? null,
    groundStop: q?.groundStop ?? null,
    pulls: arr(q?.pulls)
      .map((p) => ({
        pr: p.pr,
        head: p.head ?? null,
        error: Boolean(p.error),
        tier: p.tier ?? null,
        inspection: Boolean(p.inspection),
        blocks: blockCodes(p.blocks),
        landable: Boolean(p.landable),
      }))
      .sort((a, b) => Number(a.pr) - Number(b.pr)),
    // 때가 되면 due가 켜진다. why는 due일 때만(from → to). 아닐 때의 사유는 시각에 따라 바뀌어 뺀다
    rts: q?.rts?.due ? { due: true, why: q.rts.why ?? null } : { due: false },
  };
}

function projectOcc(i: Inputs) {
  const d = i.dispatch;
  const inflight = arr(d?.inFlight).filter((p) => p.status === "approved" || p.status === "recalling");
  const cc = i.crewChange;
  const sch = i.schedule;
  const cand = sch?.candidates;
  return {
    mode: d?.mode ?? null,
    scheduleMode: sch?.mode ?? null,
    // 메모나 BRIEFING이 아직 없는 열린·HELD 제안. SETTLED인 것만 센다(ATC-117): settled가 없는 옛 서버의 브리핑은 전부 SETTLED로 본다.
    // 제안이 SETTLED가 되면 이 목록에 ID가 들어와 지문이 저절로 바뀐다
    needsNote: [...arr(d?.open), ...arr(d?.held)].filter((p) => p.settled !== false && (!p.note || !p.briefing)).map((p) => String(p.id)).sort(),
    inFlight: inflight.map((p) => `${p.id}:${p.status}`).sort(),
    overdue: arr(d?.overdue).map(String).sort(),
    arrivalCandidates: arr(d?.arrivalCandidates).map((c) => `${c.flight}|${c.aircraft}|${c.proposal ?? ""}`).sort(),
    crewChange: {
      mode: cc?.mode ?? null,
      approved: ids(cc?.approved),
      overdue: arr(cc?.overdue).map(String).sort(),
    },
    schedule: {
      open: ids(sch?.open),
      inProgress: arr(sch?.inProgress).filter((x) => x.status === "approved" || x.status === "released").map((x) => `${x.id}:${x.status}`).sort(),
      candidates: {
        classify: arr(cand?.classify).map(String).sort(),
        prioritize: arr(cand?.prioritize).map(String).sort(),
        close: arr(cand?.close).map(String).sort(),
        tail: arr(cand?.tail).map((x) => String(x?.flight ?? x)).sort(),
        waypoint: arr(cand?.waypoint).map((x) => arr(x?.flights).map(String).sort().join("+") || String(x?.id ?? x)).sort(),
      },
      waypointGaps: arr(sch?.waypointGaps).map((g) => `${g.route}|${arr(g.waypoints).map((w) => `${w.id}:${arr(w.issues).length}:${arr(w.criteria).length}`).join(",")}`).sort(),
      slips: arr(sch?.slips).filter((s) => s.fresh).map((s) => String(s.key)).sort(),
      routesWithoutWaypoints: arr(sch?.routesWithoutWaypoints).filter((r) => r.fresh).map((r) => String(r.route)).sort(),
    },
    following: arr(i.following?.items).flatMap((f) => arr(f.issues).filter((x) => x.fresh).map((x) => String(x.key))).sort(),
  };
}

function projectCrosscheck(i: Inputs) {
  return {
    dispatch: ids(i.dispatch?.crosscheck?.pending),
    schedule: ids(i.schedule?.crosscheck?.pending),
  };
}

function projectReview(r: J) {
  return { pending: arr(r?.pending).map((p) => ({ pr: p.pr, head: p.head ?? null })).sort((a, b) => String(a.pr).localeCompare(String(b.pr))) };
}

// 역할마다 그 세션의 `/tick`이 읽는 브리핑에서 안정한 부분만 뽑는다(docs/squelch.md 4장)
export function project(role: Role, inputs: Inputs): unknown {
  switch (role) {
    case "tower":
      return projectTower(inputs.brief);
    case "mcc":
      return projectMcc(inputs.queue);
    case "occ":
      return projectOcc(inputs);
    case "crosscheck":
      return projectCrosscheck(inputs);
    case "review":
      return projectReview(inputs.reviews);
  }
}

// ── 지문 v2(ATC-297): v1에서 "바뀌어도 할 일이 아닌" 필드를 빼거나 거칠게 만든 후보 ──
// 근거는 운영 브리핑을 20초 간격으로 읽어 투영이 흔들리는 필드를 본 것이다(docs/squelch.md "Fingerprint v2 and opens-by-field as built").
// 여기 적힌 것만 v1과 다르고, 나머지 역할은 v1 그대로다. 그림자 로그(`would`)가 쌓여 틀린 skip이 0일 때만 SUPERVISOR가 역할별로 v2를 켠다.
export const INFO_ONLY_EVENTS = new Set(["handoff", "away.started", "away.ended"]); // controller/CLAUDE.md: ATC LOG에 적기만 하는 사건
// "BLOCKED — TOWER이 5분째 …"처럼 시간이 글에 박힌 경보는 분마다 문구가 바뀐다. 기간 표현만 지운다(`5분째`, `2h07m`, `24분`)
export const stripDurations = (s: string): string => s.replace(/\d+\s*분째/g, "N분째").replace(/\d+\s*분/g, "N분").replace(/\d+h\d*m?/g, "Nh").replace(/\d+m\b/g, "Nm");

function projectTowerV2(b: J) {
  const v1 = projectTower(b);
  const kinds = new Map<string, string>(arr(b?.events).map((e) => [String(e?.id), String(e?.kind)]));
  // 상태에서 만든 지시(goAround·info·fix)가 보내야 할 상태(send·supervisor)인 PR. v1은 이 상태를 보지 않으니, 더 엄격한 쪽(열림)으로 더한다
  const actions = arr(b?.landingQueue)
    .flatMap((q) => (["goAround", "info", "fix"] as const).map((k) => (q?.[k]?.action === "send" || q?.[k]?.action === "supervisor" ? `${q.airport ?? ""}#${q.pr?.number ?? ""}:${k}:${q[k].action}` : null)))
    .filter((x): x is string => x !== null)
    .sort();
  return {
    ...v1,
    actions,
    // 할 일이 아닌 사건(handoff, away.*)은 새로 와도 지문을 바꾸지 않는다. 사건은 ack 전이라 다음에 열린 tick에서 그대로 보인다
    events: v1.events.filter((id) => !INFO_ONLY_EVENTS.has(kinds.get(id) ?? "")),
    open: {
      ...v1.open,
      // level: "info"인 건강 상태(PENDING·DENIED·짧은 THROTTLE)는 ATC LOG에만 적는다
      health: v1.open.health.filter((h) => h.level !== "info"),
      healthAlerts: v1.open.healthAlerts.map((m) => (typeof m === "string" ? stripDurations(m) : m)),
    },
  };
}

export function projectV2(role: Role, inputs: Inputs): unknown {
  return role === "tower" ? projectTowerV2(inputs.brief) : project(role, inputs);
}

// 두 투영에서 바뀐 필드 경로(값은 적지 않는다). 객체의 배열은 `a[].b`로 합쳐 원소별 값의 집합이 달라졌는지 본다
function leaves(x: unknown, path: string, out: Map<string, string[]>) {
  if (Array.isArray(x)) {
    if (!x.length) {
      if (!out.has(`${path}[]`)) out.set(`${path}[]`, []);
      return;
    }
    for (const v of x) leaves(v, `${path}[]`, out);
  } else if (x && typeof x === "object") {
    for (const k of Object.keys(x as object).sort()) leaves((x as Record<string, unknown>)[k], path ? `${path}.${k}` : k, out);
  } else {
    if (path === "" && x == null) return; // 투영이 없는 쪽(null)은 필드가 없는 것으로 본다
    const l = out.get(path) ?? [];
    l.push(JSON.stringify(x) ?? "null");
    out.set(path, l);
  }
}
export function changedFields(prev: unknown, next: unknown, max = 30): string[] {
  const a = new Map<string, string[]>();
  const b = new Map<string, string[]>();
  leaves(prev, "", a);
  leaves(next, "", b);
  const out: string[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    if ((a.get(k) ?? []).slice().sort().join("\u0000") !== (b.get(k) ?? []).slice().sort().join("\u0000")) out.push(k || "(root)");
  }
  return out.sort().slice(0, max);
}

// 키를 정렬한 JSON. 같은 내용이면 키 순서와 상관없이 같은 문자열이다
export function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(",")}]`;
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(x) ?? "null";
}

export const fingerprint = (obj: unknown): string => createHash("sha256").update(canonical(obj)).digest("hex");

export interface LastPass {
  fp: string;
  openedAt: string;
}
export type OpenReason = "signal" | "manual" | "heartbeat" | "first";
export interface DecideInput {
  fp: string;
  last: LastPass | null;
  now: number;
  heartbeatMin: number;
  manualChanged: boolean;
  mode: Mode;
}

// 모드와 상관없이, 이 통과가 열려야 하는가(열어야 하면 이유, QUIET이면 null). 순서: first → manual → signal → heartbeat
export function naturalReason(x: Omit<DecideInput, "mode">): OpenReason | null {
  if (!x.last) return "first"; // 재시작 뒤 첫 통과
  if (x.manualChanged) return "manual";
  if (x.fp !== x.last.fp) return "signal";
  const opened = Date.parse(x.last.openedAt);
  if (!Number.isFinite(opened) || x.now - opened >= x.heartbeatMin * 60_000) return "heartbeat";
  return null;
}

// off·shadow는 늘 연다(shadow는 on이었다면 어땠을지를 reason에 적는다). QUIET 이유는 "quiet"
export function decide(x: DecideInput): { open: boolean; reason: string } {
  if (x.mode === "off") return { open: true, reason: "off" };
  const r = naturalReason(x);
  if (x.mode === "shadow") return { open: true, reason: r ? `shadow:${r}` : "shadow:quiet" };
  return r ? { open: true, reason: r } : { open: false, reason: "quiet" };
}
