import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Context, Hono } from "hono";
import { callsign } from "./callsign.ts";
import { config } from "./config.ts";
import { DEFAULT_DISPATCH_CONFIG, loadDispatchConfig } from "./dispatch.ts";
import type { Snapshot } from "./model.ts";

// FLEET 등록부(~/.local/state/atc/fleet.json). 팀(AIRCRAFT)마다 CREW COMPLEMENT, TYPE RATING, ROUTE, TARGETS를 적는다.
// 설계: docs/fleet.md. 이 단계에서는 보여 주고 고치기만 한다(planner는 아직 쓰지 않는다).

export const RATINGS = ["SEC", "UI", "DATA", "DOCS"] as const;
export type Rating = (typeof RATINGS)[number];

export interface CrewMember {
  position: string; // backend, ui-builder, ui-qa, flash-helper …
  agent: string; // 모델이나 에이전트 타입
  limits?: string[]; // "no SEC" 같은 제약
}
export interface Targets {
  flightsPerWeek?: number;
  onTime?: number; // 0~1
}
export interface AircraftProfile {
  base?: string | null; // AIRPORT 코드. 없으면 세션의 저장소에서
  complement?: CrewMember[]; // 없으면 defaults
  ratings?: Rating[]; // 없으면 defaults
  routes?: string[]; // Linear 프로젝트 이름
  targets?: Targets;
  note?: string;
}
export interface FleetFile {
  defaults: { complement: CrewMember[]; ratings: Rating[] };
  aircraft: Record<string, AircraftProfile>;
}

// vocado CLAUDE.md의 팀원 규칙을 옮긴 기본 CREW COMPLEMENT.
// flash-helper(DeepSeek)는 구현·리뷰 판정·보안·DB·인증·권리·이미지에 쓰지 않는다.
export const DEFAULT_FLEET: FleetFile = {
  defaults: {
    complement: [
      { position: "backend", agent: "claude-opus-5-5" },
      { position: "ui-builder", agent: "ui-builder" },
      { position: "ui-qa", agent: "ui-qa", limits: ["read-only"] },
      { position: "flash-helper", agent: "flash-helper", limits: ["no BUILD", "no CHECK verdicts", "no SEC"] },
    ],
    ratings: ["UI", "DATA", "DOCS"],
  },
  aircraft: {},
};

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

function saveAircraft(key: string, profile: AircraftProfile | null, file = fleetFile()) {
  const raw = readRaw(file);
  const aircraft = { ...(raw.aircraft ?? {}) };
  if (profile && Object.keys(profile).length) aircraft[key] = profile;
  else delete aircraft[key];
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...raw, aircraft }, null, 2) + "\n");
  renameSync(tmp, file);
}

// SEC는 보안 작업을 맡을 수 있는 팀원(flash-helper가 아니고 "no SEC" 제약이 없는)이 있어야 준다.
export function canHoldSec(complement: CrewMember[]): boolean {
  return complement.some((m) => m.agent !== "flash-helper" && !(m.limits ?? []).includes("no SEC"));
}

// PATCH 본문을 검사해 프로필로 만든다. 값이 null이면 그 항목을 지워 기본값으로 돌린다.
export function applyPatch(current: AircraftProfile, patch: Record<string, unknown>, defaults: FleetFile["defaults"]): AircraftProfile {
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
}

// 스냅샷의 TEAM 세션과 등록부를 합친다. 세션이 없는 등록 항목도 "absent"로 보인다.
export function fleetView(s: Pick<Snapshot, "sessions" | "claims" | "workspaces" | "airports">, fleet: FleetFile, teamPattern = DEFAULT_DISPATCH_CONFIG.teamPattern): AircraftView[] {
  const team = new RegExp(teamPattern, "i");
  const codeOf = (repo: string | null) => s.airports.find((a) => a.repo === repo)?.code ?? null;
  const wsTicket = new Map(s.workspaces.map((w) => [w.path, w.ticketKey]));
  const live = s.sessions.filter((x) => team.test(x.name) && x.status !== "dead");
  const names = [...new Set([...live.map((x) => x.name.toUpperCase()), ...Object.keys(fleet.aircraft).map((k) => k.toUpperCase())])].sort();
  return names.map((reg) => {
    const session = live.find((x) => x.name.toUpperCase() === reg);
    const profile = Object.entries(fleet.aircraft).find(([k]) => k.toUpperCase() === reg)?.[1] ?? {};
    const flying = session
      ? [...new Set(s.claims.filter((c) => c.sessionId === session.id && c.state === "active").map((c) => wsTicket.get(c.workspacePath)).filter(Boolean) as string[])]
      : [];
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
    };
  });
}

export function mountFleet(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  app.get("/api/fleet", async (c) => {
    const s = await getSnapshot();
    const fleet = loadFleet();
    const projects = [...new Set(s.tickets.map((t) => t.project).filter(Boolean) as string[])].sort();
    return c.json({ ratings: RATINGS, defaults: fleet.defaults, projects, aircraft: fleetView(s, fleet, loadDispatchConfig().teamPattern) });
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
      if (Object.keys(next).length) fleet.aircraft[key] = next;
      else delete fleet.aircraft[key];
      return c.json({ ok: true, aircraft: fleetView(await getSnapshot(), fleet, teamPattern).find((a) => a.registration === reg) });
    } catch (e) {
      if (e instanceof FleetError) return c.json({ error: e.message }, e.status as 400);
      throw e;
    }
  });
}
