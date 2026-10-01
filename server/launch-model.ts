// LAUNCH MODEL(ATC-279): AIRCRAFT LAUNCH가 `--model`로 넘길 모델을 정하는 설정. 순수, import 없음(화면도 쓴다).
// fleet.json 최상위 `launchModel` = { default?: "<모델>", airports?: { "<CODE>": "<모델>" }, aircraft?: { "<REG>": "<모델>" } }.
// 없으면 전과 같다: `--model`을 붙이지 않고 폴더(ACCOUNT·프로젝트) settings가 정한다. 설정은 다음 LAUNCH에만 쓴다. 돌고 있는 세션은 모델을 바꾸지 않는다.
// 관제 세션과 crew 서브에이전트 모델(CLAUDE_CODE_SUBAGENT_MODEL)은 이 설정이 아니다.

// Claude Code 별칭(opus, sonnet, haiku, 뒤에 [1m])과 전체 ID. session-control.ts의 모델 검사와 같은 규칙
export const MODEL_RE = /^[\w.:[\]-]+$/;
export const MODEL_CHOICES = ["opus", "sonnet", "haiku", "claude-opus-5-5", "claude-sonnet-5-5"] as const;

export interface LaunchModelSetting {
  default?: string;
  airports?: Record<string, string>;
  aircraft?: Record<string, string>;
}

export type ModelFrom = "form" | "aircraft" | "airport" | "default" | "last" | "none";

const isModel = (v: unknown): v is string => typeof v === "string" && MODEL_RE.test(v);
const mapOf = (raw: unknown, key: (k: string) => string): Record<string, string> => {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isModel(v)) out[key(k)] = v;
  return out;
};

// 파일에서 읽을 때: 모양이 맞는 칸만(잘못된 값·알 수 없는 칸은 버린다). 옛 파일엔 없다
export function launchModelSettingOf(raw: unknown): LaunchModelSetting {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const airports = mapOf(o.airports, (k) => k.toUpperCase());
  const aircraft = mapOf(o.aircraft, (k) => k.toUpperCase());
  return {
    ...(isModel(o.default) ? { default: o.default } : {}),
    ...(Object.keys(airports).length ? { airports } : {}),
    ...(Object.keys(aircraft).length ? { aircraft } : {}),
  };
}

// 우선순위: LAUNCH 양식·FLEET PLAN 승인 양식에 적은 모델(form) > AIRCRAFT > AIRPORT > 기본 > 마지막 LAUNCH(last) > 없음.
// 마지막 LAUNCH의 모델(RESTART·ACCOUNT CHANGE·REPOSITION·APPLY NOW·DISPATCH launch 카드가 전에 쓰던 값)은 설정이 하나도 안 맞을 때만 쓴다:
// 설정은 SUPERVISOR의 지금 뜻이다
export function launchModelOf(input: { registration: string; airport: string | null; explicit?: string | null; last?: string | null; setting?: LaunchModelSetting | null }): { model: string | null; from: ModelFrom } {
  const s = input.setting ?? {};
  const explicit = input.explicit?.trim();
  if (explicit) return { model: explicit, from: "form" };
  const byAircraft = s.aircraft?.[input.registration.toUpperCase()];
  if (byAircraft) return { model: byAircraft, from: "aircraft" };
  const byAirport = input.airport ? s.airports?.[input.airport.toUpperCase()] : undefined;
  if (byAirport) return { model: byAirport, from: "airport" };
  if (s.default) return { model: s.default, from: "default" };
  const last = input.last?.trim();
  if (last) return { model: last, from: "last" };
  return { model: null, from: "none" };
}

// PUT 본문 검사. 본문에 적힌 칸만 바꾼다: 모델이면 그것, null·""이면 지운다. AIRPORT·AIRCRAFT는 등록된 것만. 모르는 칸·잘못된 값은 거절
export type ModelPatch = { ok: true; next: LaunchModelSetting; changes: { scope: "default" | "airport" | "aircraft"; key: string | null; from: string | null; to: string | null }[] } | { ok: false; error: string; status: 400 | 409 };

export function launchModelPatchOf(current: LaunchModelSetting, body: unknown, ctx: { airports: readonly string[]; aircraft: readonly string[] }): ModelPatch {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "본문은 { default?, airports?, aircraft? } 객체", status: 400 };
  const b = body as Record<string, unknown>;
  const unknown = Object.keys(b).filter((k) => !["default", "airports", "aircraft"].includes(k));
  if (unknown.length) return { ok: false, error: `모르는 칸: ${unknown.join(", ")} (default, airports, aircraft)`, status: 400 };
  if (!("default" in b || "airports" in b || "aircraft" in b)) return { ok: false, error: "default, airports, aircraft 중 하나는 있어야 함", status: 400 };
  const next: LaunchModelSetting = { ...current, ...(current.airports ? { airports: { ...current.airports } } : {}), ...(current.aircraft ? { aircraft: { ...current.aircraft } } : {}) };
  const changes: { scope: "default" | "airport" | "aircraft"; key: string | null; from: string | null; to: string | null }[] = [];
  const value = (v: unknown, where: string): { ok: true; model: string | null } | { ok: false; error: string } => {
    if (v === null || v === "") return { ok: true, model: null };
    if (typeof v !== "string" || !MODEL_RE.test(v.trim())) return { ok: false, error: `${where}: 모델은 별칭(opus, sonnet, haiku, 뒤에 [1m])이나 전체 ID(글자·숫자·. : [ ] - _)이거나 비움("폴더 기본")` };
    return { ok: true, model: v.trim() };
  };
  if ("default" in b) {
    const v = value(b.default, "default");
    if (!v.ok) return { ok: false, error: v.error, status: 400 };
    changes.push({ scope: "default", key: null, from: current.default ?? null, to: v.model });
    if (v.model) next.default = v.model;
    else delete next.default;
  }
  for (const [field, scope, known] of [["airports", "airport", ctx.airports], ["aircraft", "aircraft", ctx.aircraft]] as const) {
    if (!(field in b)) continue;
    const m = b[field];
    if (!m || typeof m !== "object" || Array.isArray(m)) return { ok: false, error: `${field}는 { <${scope === "airport" ? "CODE" : "REG"}>: 모델 } 객체`, status: 400 };
    for (const [rawKey, rawVal] of Object.entries(m as Record<string, unknown>)) {
      const key = rawKey.trim().toUpperCase();
      const v = value(rawVal, `${field}.${key}`);
      if (!v.ok) return { ok: false, error: v.error, status: 400 };
      const map = (next[field] ??= {});
      const from = map[key] ?? null;
      // 지우는 것은 등록에서 사라진 키도 허용한다(남은 값을 치울 길이 있어야 한다)
      if (v.model && !known.some((k) => k.toUpperCase() === key)) return { ok: false, error: `등록되지 않은 ${scope === "airport" ? "AIRPORT" : "AIRCRAFT"}: ${key}`, status: 409 };
      changes.push({ scope, key, from, to: v.model });
      if (v.model) map[key] = v.model;
      else delete map[key];
      if (!Object.keys(map).length) delete next[field];
    }
  }
  return { ok: true, next, changes: changes.filter((c) => c.from !== c.to) };
}

const SOURCE_TEXT: Record<ModelFrom, string> = { form: "양식", aircraft: "AIRCRAFT", airport: "AIRPORT", default: "기본", last: "마지막 LAUNCH", none: "폴더 기본" };

// FLEET 행·카드·DISPATCH launch 카드의 "next LAUNCH model" 표시. 설정이 하나도 안 맞으면 null(폴더 설정이 정한다 — 전과 같다)
export function nextModelNote(input: { registration: string; airport: string | null; setting?: LaunchModelSetting | null }): string | null {
  const r = launchModelOf({ registration: input.registration, airport: input.airport, setting: input.setting });
  return r.model ? `next LAUNCH model ${r.model} (${SOURCE_TEXT[r.from]})` : null;
}
export const NEXT_MODEL_TITLE = "다음 LAUNCH가 `--model`로 넘길 모델. 설정 → ACCOUNTS의 LAUNCH MODEL(AIRCRAFT > AIRPORT > 기본). 돌고 있는 세션은 옮기지 않는다";
