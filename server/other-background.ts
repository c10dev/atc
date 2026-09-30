import { callsign } from "./callsign.ts";
import { DEFAULT_TEAM_PATTERN, registrationOf, sameReg } from "./registration.ts";

// 그 밖의 백그라운드 세션(ATC-184, docs/fleet.md 8.5.3): AIRCRAFT도 관제 세션도 아닌데 ATC_MAX_LAUNCHED 자리를 차지하는 세션.
// 상한이 세는 것은 그대로(살아 있는 백그라운드 세션에서 관제 세션과 STALE만 뺀 것)이고, 여기는 그 자리를 누가 쥐었는지 보이기만 한다. 순수 함수.

// `claude agents --json` 한 줄에서 쓰는 칸만(session-control.ts의 AgentRow를 그대로 받는다)
export interface BgRow {
  id?: string;
  sessionId?: string;
  name?: string;
  kind: string;
  status?: string;
  cwd: string;
  stale?: boolean;
  account?: string;
}

export interface OtherBackground {
  id: string; // 백그라운드 세션의 짧은 id(claude stop에 쓴다)
  name: string; // 이름이 없으면 id
  cwd: string;
  cwdShort: string; // ~/projects 아래면 상대 경로
  status: string | null;
  job: { state: string; detail: string; tempo: string | null } | null;
  lastActiveAt: string | null; // 대화 기록 mtime, 없으면 job의 updatedAt
  idleMin: number | null;
  account: string | null;
}

export interface OtherOptions {
  teamPattern?: string;
  controlDirs?: readonly string[]; // 관제 폴더(실제 경로). 그 폴더에서 연 세션도 관제 세션이다
  resolve?: (path: string) => string; // cwd → 실제 경로(기본은 그대로)
  projectsRoot?: string; // 이 아래면 cwdShort는 상대 경로
  jobOf?: (id: string) => { state: string; detail: string; tempo?: string | null; writtenAt?: string | null } | null;
  lastActiveOf?: (row: BgRow) => string | null;
  now?: number;
}

// 이 이름이 AIRCRAFT인가(FLEET와 같은 읽기): teamPattern에 맞는 이름이거나, 등록부의 REGISTRATION·콜사인과 같은 이름
export function isAircraftName(name: string | null | undefined, registry: readonly string[], teamPattern = DEFAULT_TEAM_PATTERN): boolean {
  if (!name) return false;
  if (registrationOf(name, teamPattern) !== null) return true;
  const up = name.trim().toUpperCase();
  return registry.some((reg) => sameReg(name, reg, teamPattern) || callsign({ name: reg }).toUpperCase() === up);
}

const isControl = (row: BgRow, controlNames: readonly string[], o: OtherOptions) =>
  controlNames.some((n) => (row.name ?? "").trim().toUpperCase() === n.toUpperCase()) || (o.controlDirs ?? []).includes((o.resolve ?? ((p) => p))(row.cwd));

const idleMinOf = (at: string | null, now: number) => (at && Number.isFinite(Date.parse(at)) ? Math.max(0, Math.floor((now - Date.parse(at)) / 60_000)) : null);

// 살아 있는 백그라운드 줄 가운데 AIRCRAFT도 관제 세션도 아닌 것. STALE 줄은 상한이 세지 않으므로 뺀다
export function otherBackgroundOf(rows: readonly BgRow[], registry: readonly string[], controlNames: readonly string[], o: OtherOptions = {}): OtherBackground[] {
  const now = o.now ?? Date.now();
  return rows
    .filter((r) => r.kind === "background" && !r.stale && r.id && !isControl(r, controlNames, o) && !isAircraftName(r.name, registry, o.teamPattern))
    .map((r) => {
      const job = o.jobOf?.(r.id!) ?? null;
      const lastActiveAt = o.lastActiveOf?.(r) ?? job?.writtenAt ?? null;
      const root = o.projectsRoot?.replace(/\/$/, "");
      return {
        id: r.id!,
        name: r.name?.trim() || r.id!,
        cwd: r.cwd,
        cwdShort: root && r.cwd.startsWith(`${root}/`) ? r.cwd.slice(root.length + 1) : r.cwd === root ? "." : r.cwd,
        status: r.status ?? null,
        job: job ? { state: job.state, detail: job.detail, tempo: job.tempo ?? null } : null,
        lastActiveAt,
        idleMin: idleMinOf(lastActiveAt, now),
        account: r.account ?? null,
      };
    });
}

// 자리를 쥔 쪽: AIRCRAFT 몇, 그 밖 몇(이름과 놀고 있는 시간)
export interface CapHolders {
  aircraft: number;
  other: { name: string; idleMin: number | null }[];
}
// rows는 상한이 세는 줄(관제·STALE 뺀 살아 있는 백그라운드)이다. idleOf는 줄마다 놀고 있는 분(모르면 null)
export function capHoldersOf<R extends Pick<BgRow, "name" | "kind" | "stale">>(rows: readonly R[], registry: readonly string[], idleOf: (row: R) => number | null = () => null, teamPattern = DEFAULT_TEAM_PATTERN): CapHolders {
  const counted = rows.filter((r) => r.kind === "background" && !r.stale);
  const other = counted.filter((r) => !isAircraftName(r.name, registry, teamPattern)).map((r) => ({ name: r.name?.trim() || "(이름 없음)", idleMin: idleOf(r) }));
  return { aircraft: counted.length - other.length, other };
}

export const idleText = (min: number | null) => (min === null ? null : min >= 60 ? `${Math.floor(min / 60)}h idle` : `${min}m idle`);

// `AIRCRAFT 6 · 그 밖 1 (ENGINEERING-NIGHT, 6h idle)`. 그 밖이 없으면 `그 밖 0`
export function capHoldersText(h: CapHolders): string {
  const names = h.other.map((o) => [o.name, idleText(o.idleMin)].filter(Boolean).join(", "));
  return `AIRCRAFT ${h.aircraft} · 그 밖 ${h.other.length}${names.length ? ` (${names.join("; ")})` : ""}`;
}

// 상한이 찼을 때 한 줄: `백그라운드 7/7 — AIRCRAFT 6 · 그 밖 1 (ENGINEERING-NIGHT, 6h idle)`
export const capLine = (launched: number, max: number, h: CapHolders) => `백그라운드 ${launched}/${max} — ${capHoldersText(h)}`;

// ── 놀고 있는 자리 힌트(ADVISORY, 알리기만 한다) ──
export const CAP_IDLE_MIN = 120;
export interface CapIdleHint {
  id: string;
  name: string;
  idleMin: number;
  refused: string; // 상한 때문에 막힌 LAUNCH(그 카드의 AIRCRAFT나 FLIGHT)
}
// 상한이 찬 채 LAUNCH가 기다리는 동안(refused가 있을 때), 120분 넘게 논 그 밖의 백그라운드 세션마다 하나
export function capIdleHintsOf(others: readonly Pick<OtherBackground, "id" | "name" | "idleMin">[], refused: readonly string[], minIdle = CAP_IDLE_MIN): CapIdleHint[] {
  if (!refused.length) return [];
  return others.filter((o) => o.idleMin !== null && o.idleMin > minIdle).map((o) => ({ id: o.id, name: o.name, idleMin: o.idleMin!, refused: refused.join(", ") }));
}
