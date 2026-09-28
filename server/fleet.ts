import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Context, Hono } from "hono";
import { callsign } from "./callsign.ts";
import { config } from "./config.ts";
import { noteCrewChange, withCrew } from "./crew-change.ts";
import { OBSERVED_WINDOW_DAYS } from "./crew-observed.ts";
import { DEFAULT_DISPATCH_CONFIG, loadDispatchConfig } from "./dispatch.ts";
import { type Actuals, computeActuals, type LogEntry, loadLogbook } from "./logbook.ts";
import type { Snapshot } from "./model.ts";
import { loadRulesRecords, rulesOfAircraft, type RulesView } from "./rules-state.ts";

// FLEET 등록부(~/.local/state/atc/fleet.json). 팀(AIRCRAFT)마다 CREW COMPLEMENT, TYPE RATING, ROUTE, TARGETS를 적는다.
// 설계: docs/fleet.md. 타입·기본값·판정은 crew.ts에 있고, planner도 그것을 쓴다.

import {
  type AircraftProfile,
  CONFIGURATIONS,
  type ConfigurationId,
  canHoldSec,
  type CrewMember,
  DEFAULT_FLEET,
  type FleetFile,
  RATINGS,
  type Rating,
  type Targets,
} from "./crew.ts";

export { canHoldSec, DEFAULT_FLEET, RATINGS };
export type { AircraftProfile, CrewMember, FleetFile, Rating, Targets };

export class FleetError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const fleetFile = () => join(config.stateDir, "fleet.json");

// 파일에 적힌 그대로(기본값을 채우지 않은 것). 저장할 때는 이것을 고쳐 쓴다 — 그래야 파일에 없는
// defaults는 코드의 기본값을 계속 따라간다.
function readRaw(file: string): Partial<FleetFile> {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function loadFleet(file = fleetFile()): FleetFile {
  const raw = readRaw(file);
  return {
    defaults: { ...structuredClone(DEFAULT_FLEET.defaults), ...(raw.defaults ?? {}) },
    aircraft: raw.aircraft && typeof raw.aircraft === "object" ? raw.aircraft : {},
  };
}

export function saveAircraft(key: string, profile: AircraftProfile | null, file = fleetFile()) {
  const raw = readRaw(file);
  const aircraft = { ...(raw.aircraft ?? {}) };
  if (profile && Object.keys(profile).length) aircraft[key] = profile;
  else delete aircraft[key];
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...raw, aircraft }, null, 2) + "\n");
  renameSync(tmp, file);
}


// PATCH 본문을 검사해 프로필로 만든다. 값이 null이면 그 항목을 지워 기본값으로 돌린다.
export function applyPatch(
  current: AircraftProfile,
  patch: Record<string, unknown>,
  defaults: FleetFile["defaults"],
  now = new Date().toISOString(),
): AircraftProfile {
  const next: AircraftProfile = { ...current };
  const drop = (k: keyof AircraftProfile) => delete next[k];

  if ("ratings" in patch) {
    if (patch.ratings === null) drop("ratings");
    else {
      if (!Array.isArray(patch.ratings)) throw new FleetError("ratings는 배열");
      const bad = patch.ratings.find((r) => !RATINGS.includes(r as Rating));
      if (bad !== undefined) throw new FleetError(`모르는 TYPE RATING: ${bad} (가능: ${RATINGS.join(", ")})`);
      next.ratings = [...new Set(patch.ratings as Rating[])].sort((a, b) => RATINGS.indexOf(a) - RATINGS.indexOf(b));
    }
  }
  if ("complement" in patch) {
    if (patch.complement === null) drop("complement");
    else {
      if (!Array.isArray(patch.complement) || !patch.complement.length) throw new FleetError("complement는 한 명 이상의 배열");
      next.complement = patch.complement.map((m, i) => {
        const x = m as Partial<CrewMember>;
        if (typeof x?.position !== "string" || !x.position.trim() || typeof x.agent !== "string" || !x.agent.trim()) {
          throw new FleetError(`complement[${i}]에 position과 agent가 필요함`);
        }
        const limits = Array.isArray(x.limits) ? x.limits.map(String).filter(Boolean) : [];
        return { position: x.position.trim(), agent: x.agent.trim(), ...(limits.length ? { limits } : {}) };
      });
    }
  }
  if ("routes" in patch) {
    if (patch.routes === null) drop("routes");
    else {
      if (!Array.isArray(patch.routes)) throw new FleetError("routes는 배열");
      next.routes = [...new Set(patch.routes.map(String).map((r) => r.trim()).filter(Boolean))];
    }
  }
  if ("targets" in patch) {
    if (patch.targets === null) drop("targets");
    else {
      const t = patch.targets as Record<string, unknown>;
      const out: Targets = {};
      if (t.flightsPerWeek != null) {
        const n = Number(t.flightsPerWeek);
        if (!Number.isFinite(n) || n < 0 || n > 100) throw new FleetError("flightsPerWeek는 0~100");
        out.flightsPerWeek = n;
      }
      if (t.onTime != null) {
        const n = Number(t.onTime);
        if (!Number.isFinite(n) || n < 0 || n > 1) throw new FleetError("onTime은 0~1");
        out.onTime = n;
      }
      if (Object.keys(out).length) next.targets = out;
      else drop("targets");
    }
  }
  if ("base" in patch) {
    if (patch.base === null || patch.base === "") drop("base");
    else if (typeof patch.base !== "string" || !/^[A-Z]{4}$/.test(patch.base)) throw new FleetError("base는 AIRPORT 코드(대문자 4자)");
    else next.base = patch.base;
  }
  if ("note" in patch) {
    if (patch.note === null || patch.note === "") drop("note");
    else next.note = String(patch.note).slice(0, 500);
  }
  // AOG: 잠시 운항 중지. 사유가 있어야 하고, 해제 예정일(YYYY-MM-DD)은 선택
  if ("aog" in patch) {
    if (patch.aog === null || patch.aog === false) drop("aog");
    else {
      const a = patch.aog as { reason?: unknown; until?: unknown };
      const reason = typeof a?.reason === "string" ? a.reason.trim() : "";
      if (!reason) throw new FleetError("AOG에는 사유가 필요함");
      const until = typeof a.until === "string" && a.until.trim() ? a.until.trim() : null;
      if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new FleetError("AOG 해제 예정일은 YYYY-MM-DD");
      next.aog = { reason: reason.slice(0, 200), until, at: now };
    }
  }
  // RETIREMENT: 퇴역. false면 복귀
  if ("retired" in patch) {
    if (patch.retired === null || patch.retired === false) drop("retired");
    else {
      const r = patch.retired as { reason?: unknown } | true;
      const reason = r !== true && typeof r?.reason === "string" && r.reason.trim() ? r.reason.trim().slice(0, 200) : null;
      next.retired = { at: now, reason };
    }
  }

  const complement = next.complement ?? defaults.complement;
  const ratings = next.ratings ?? defaults.ratings;
  if (ratings.includes("SEC") && !canHoldSec(complement)) {
    throw new FleetError("SEC는 보안 작업을 맡을 수 있는 팀원이 있어야 준다 — flash-helper만으로는 안 됨");
  }
  return next;
}

export interface AircraftView {
  registration: string;
  callsign: string;
  status: "busy" | "idle" | "dead" | "absent";
  base: string | null;
  complement: CrewMember[];
  complementIsDefault: boolean;
  ratings: Rating[];
  ratingsIsDefault: boolean;
  routes: string[];
  targets: Targets;
  note: string | null;
  flying: string[]; // 지금 STAND를 쥔 FLIGHT
  flights: { key: string; title: string | null }[]; // flying과 같은 순서, Linear 제목(모르면 null). FLEET 운항 상태 목록(ATC-44)
  flyingSince: string | null; // 지금 쥔 STAND를 처음 잡은 시각(점유 since 중 가장 이른 것). 없으면 null
  lastActiveAt: string | null; // 세션의 마지막 활동 시각
  configuration: ConfigurationId | null;
  enteredAt: string | null;
  aog: AircraftProfile["aog"] | null;
  retired: AircraftProfile["retired"] | null;
  actuals: Actuals; // LOGBOOK에서 센 TARGETS 실적(보여 주기만 함, docs/fleet.md 7.2)
}

// 스냅샷의 TEAM 세션과 등록부를 합친다. 세션이 없는 등록 항목도 "absent"로 보인다.
export function fleetView(
  s: Pick<Snapshot, "sessions" | "claims" | "workspaces" | "airports"> & Partial<Pick<Snapshot, "tickets">>,
  fleet: FleetFile,
  teamPattern = DEFAULT_DISPATCH_CONFIG.teamPattern,
  logbook: LogEntry[] = [],
  now = Date.now(),
): AircraftView[] {
  const team = new RegExp(teamPattern, "i");
  const codeOf = (repo: string | null) => s.airports.find((a) => a.repo === repo)?.code ?? null;
  const wsTicket = new Map(s.workspaces.map((w) => [w.path, w.ticketKey]));
  const live = s.sessions.filter((x) => team.test(x.name) && x.status !== "dead");
  const names = [...new Set([...live.map((x) => x.name.toUpperCase()), ...Object.keys(fleet.aircraft).map((k) => k.toUpperCase())])].sort();
  return names.map((reg) => {
    const session = live.find((x) => x.name.toUpperCase() === reg);
    const profile = Object.entries(fleet.aircraft).find(([k]) => k.toUpperCase() === reg)?.[1] ?? {};
    const held = session ? s.claims.filter((c) => c.sessionId === session.id && c.state === "active") : [];
    const flying = [...new Set(held.map((c) => wsTicket.get(c.workspacePath)).filter(Boolean) as string[])];
    return {
      registration: reg,
      callsign: callsign({ name: reg }),
      status: session ? session.status : "absent",
      base: profile.base ?? (session ? codeOf(session.repo) : null),
      complement: profile.complement ?? fleet.defaults.complement,
      complementIsDefault: !profile.complement,
      ratings: profile.ratings ?? fleet.defaults.ratings,
      ratingsIsDefault: !profile.ratings,
      routes: profile.routes ?? [],
      targets: profile.targets ?? {},
      note: profile.note ?? null,
      flying,
      flights: flying.map((key) => ({ key, title: s.tickets?.find((t) => t.key === key)?.title ?? null })),
      flyingSince: held.map((c) => c.since).sort()[0] ?? null,
      lastActiveAt: session?.lastActiveAt ?? null,
      configuration: profile.configuration ?? null,
      enteredAt: profile.enteredAt ?? null,
      aog: profile.aog ?? null,
      retired: profile.retired ?? null,
      actuals: computeActuals(logbook, reg, now),
    };
  });
}

// 새 AIRCRAFT의 기본 AIRPORT: 살아 있는 TEAM 세션이 가장 많은 AIRPORT, 없으면 DISPATCH가 배정하는 첫 AIRPORT
export function defaultBase(s: Pick<Snapshot, "sessions" | "airports">, teamPattern: string): string | null {
  const team = new RegExp(teamPattern, "i");
  const count = new Map<string, number>();
  for (const x of s.sessions) {
    const code = s.airports.find((a) => a.repo === x.repo)?.code;
    if (code && team.test(x.name) && x.status !== "dead") count.set(code, (count.get(code) ?? 0) + 1);
  }
  const top = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
  const mapped = Object.values(loadDispatchConfig().projectAirports).find(Boolean) ?? null;
  return top ?? (mapped && s.airports.some((a) => a.code === mapped) ? mapped : (s.airports[0]?.code ?? null));
}

// 비어 있는 다음 등록번호: TEAM_A … TEAM_Z 중 세션도 등록 항목도 없는 첫 글자
export function nextRegistration(taken: Iterable<string>): string | null {
  const used = new Set([...taken].map((x) => x.toUpperCase()));
  for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!used.has(`TEAM_${c}`)) return `TEAM_${c}`;
  return null;
}

// ENTRY INTO SERVICE: 새 AIRCRAFT를 FLEET에 들인다. 세션은 사용자가 CREW BRIEFING을 붙여 넣어 연다.
// 템플릿이 general이면 팀원·자격은 기본값을 따르게 비워 둔다.
export function entryIntoService(
  fleet: FleetFile,
  input: Record<string, unknown>,
  liveNames: string[],
  teamPattern: string,
  now = new Date().toISOString(),
): { registration: string; profile: AircraftProfile } {
  const reg = String(input.registration ?? "").trim().toUpperCase();
  if (!new RegExp(teamPattern, "i").test(reg)) throw new FleetError(`등록번호는 TEAM_X 형식: ${reg || "(비었음)"}`);
  const existing = Object.entries(fleet.aircraft).find(([k]) => k.toUpperCase() === reg)?.[1];
  if (existing?.retired) throw new FleetError(`${reg}는 퇴역 상태 — 복귀(RETIREMENT 해제)를 쓰세요`, 409);
  if (existing || liveNames.some((n) => n.toUpperCase() === reg)) throw new FleetError(`${reg}는 이미 FLEET에 있음`, 409);
  const cfgId = String(input.configuration ?? "general") as ConfigurationId;
  const template = CONFIGURATIONS[cfgId];
  if (!template) throw new FleetError(`모르는 CONFIGURATION: ${cfgId} (가능: ${Object.keys(CONFIGURATIONS).join(", ")})`);
  const patch: Record<string, unknown> = {
    base: input.base ?? null,
    routes: input.routes ?? null,
    note: input.note ?? null,
    ...(cfgId === "general" ? {} : { complement: template.complement, ratings: template.ratings }),
  };
  const profile = applyPatch({}, patch, fleet.defaults, now);
  return { registration: reg, profile: { ...profile, configuration: cfgId, enteredAt: now } };
}

// CREW BRIEFING: 새 세션에 붙여 넣을 시작 지시문. 팀 세션은 vocado CLAUDE.md를 따르므로 한국어로 쓴다.
export function crewBriefing(a: AircraftView, repo: string | null, mode: "shadow" | "approval"): string {
  const crew = a.complement.map((m) => `- ${m.position}: ${m.agent}${m.limits?.length ? ` (${m.limits.join(", ")})` : ""}`);
  const lines = [
    `[ATC FLEET] CREW BRIEFING · ${a.callsign} (${a.registration})${a.base ? ` · AIRPORT ${a.base}` : ""}`,
    "",
    `이 세션의 이름은 ${a.registration}입니다.${repo ? ` 작업 폴더는 ${repo}입니다.` : ""} 당신은 이 팀의 CAPTAIN(리더)이고, 그 저장소의 CLAUDE.md 팀 규칙을 따릅니다.`,
    "",
    "CREW COMPLEMENT (팀원을 만들 때 이 구성과 모델을 씁니다)",
    ...crew,
    "",
    `TYPE RATING: ${a.ratings.join(", ") || "없음"} — 이 범위의 FLIGHT가 배정됩니다.${a.ratings.includes("SEC") ? " SEC 작업은 Codex Engineering Task 템플릿을 쓰고 flash-helper(DeepSeek)는 쓰지 않습니다." : " SEC(DB·보안·권리) 작업은 받지 않습니다."}`,
    `ROUTE: ${a.routes.join(", ") || "지정 없음"}`,
    "",
    "배정과 교신",
    `- Linear 라벨이 tail:${a.registration}인 이슈는 이 팀 몫입니다. Linear에는 CAPTAIN만 씁니다.`,
    "- atc TOWER가 [ATC C-xxxx]로 시작하는 CLEARANCE를 보내면 그 메시지에 READBACK C-xxxx로 답합니다.",
    ...(mode === "approval" ? ["- atc OCC가 [DISPATCH D-xxxx] FLIGHT PLAN을 보내면 맡을 때 READBACK D-xxxx, 못 맡으면 사유로 답합니다."] : []),
    "",
    `준비가 끝나면 \"${a.registration} IN SERVICE\" 한 줄만 남기고 배정을 기다리세요.`,
  ];
  return lines.join("\n");
}

export function mountFleet(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  app.get("/api/fleet", async (c) => {
    const s = await getSnapshot();
    const fleet = loadFleet();
    const projects = [...new Set(s.tickets.map((t) => t.project).filter(Boolean) as string[])].sort();
    const cfg = loadDispatchConfig();
    // RULES(ATC-42): 그 AIRCRAFT의 살아 있는 세션이 규칙 파일 변경을 확인했나. rules-drift hook 기록이 없으면 null
    const rulesRecords = loadRulesRecords();
    const rulesOf = (reg: string): RulesView | null => rulesOfAircraft(s.sessions.filter((x) => x.status !== "dead" && x.name.toUpperCase() === reg), rulesRecords);
    const aircraft = fleetView(s, fleet, cfg.teamPattern, loadLogbook()).map(withCrew(s)).map((a) => ({ ...a, rules: rulesOf(a.registration) }));
    const configurations = Object.entries(CONFIGURATIONS).map(([id, t]) => ({ id, label: t.label, complement: t.complement, ratings: t.ratings }));
    return c.json({
      ratings: RATINGS,
      defaults: fleet.defaults,
      projects,
      aircraft,
      observedWindowDays: OBSERVED_WINDOW_DAYS,
      configurations,
      airports: s.airports.map((a) => a.code),
      defaultBase: defaultBase(s, cfg.teamPattern),
      dispatchMode: cfg.mode, // approval(2b)일 때만 CREW CHANGE 승인을 보인다
      nextRegistration: nextRegistration([...aircraft.map((a) => a.registration), ...s.sessions.map((x) => x.name)]),
    });
  });
  // ENTRY INTO SERVICE
  app.post("/api/fleet", async (c: Context) => {
    const s = await getSnapshot();
    const teamPattern = loadDispatchConfig().teamPattern;
    const fleet = loadFleet();
    const body = await c.req.json().catch(() => ({}));
    const live = s.sessions.filter((x) => x.status !== "dead").map((x) => x.name);
    try {
      const base = body.base ?? defaultBase(s, teamPattern);
      const { registration, profile } = entryIntoService(fleet, { ...body, base }, live, teamPattern);
      saveAircraft(registration, profile);
      fleet.aircraft[registration] = profile;
      return c.json({ ok: true, aircraft: fleetView(s, fleet, teamPattern, loadLogbook()).find((a) => a.registration === registration) });
    } catch (e) {
      if (e instanceof FleetError) return c.json({ error: e.message }, e.status as 400);
      throw e;
    }
  });
  app.get("/api/fleet/:registration/briefing", async (c) => {
    const reg = (c.req.param("registration") ?? "").toUpperCase();
    const s = await getSnapshot();
    const cfg = loadDispatchConfig();
    const a = fleetView(s, loadFleet(), cfg.teamPattern).find((x) => x.registration === reg);
    if (!a) return c.json({ error: `FLEET에 없음: ${reg}` }, 404);
    const repo = s.airports.find((x) => x.code === a.base)?.repo ?? null;
    return c.json({ registration: reg, briefing: crewBriefing(a, repo, cfg.mode) });
  });
  app.patch("/api/fleet/:registration", async (c: Context) => {
    const reg = (c.req.param("registration") ?? "").toUpperCase();
    const teamPattern = loadDispatchConfig().teamPattern;
    if (!new RegExp(teamPattern, "i").test(reg)) return c.json({ error: `TEAM 이름이 아님: ${reg}` }, 400);
    const body = await c.req.json().catch(() => ({}));
    const fleet = loadFleet();
    const key = Object.keys(fleet.aircraft).find((k) => k.toUpperCase() === reg) ?? reg;
    try {
      const next = applyPatch(fleet.aircraft[key] ?? {}, body, fleet.defaults);
      saveAircraft(key, next);
      const s = await getSnapshot();
      noteCrewChange(reg, fleet.aircraft[key] ?? {}, next, fleet.defaults, s.sessions); // CREW CHANGE 기록(2b에서는 승인 뒤 OCC가 보냄)
      if (Object.keys(next).length) fleet.aircraft[key] = next;
      else delete fleet.aircraft[key];
      return c.json({ ok: true, aircraft: fleetView(s, fleet, teamPattern, loadLogbook()).map(withCrew(s)).find((a) => a.registration === reg) });
    } catch (e) {
      if (e instanceof FleetError) return c.json({ error: e.message }, e.status as 400);
      throw e;
    }
  });
}
