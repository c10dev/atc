// FLEET와 FLIGHT 분류의 순수한 부분(타입, 기본값, 판정). 설계: docs/fleet.md.
// fleet.ts(등록부·API)와 dispatch.ts(planner)가 함께 쓴다. 다른 서버 모듈을 import하지 않는다(순환 방지).

export const RATINGS = ["SEC", "UI", "DATA", "DOCS"] as const;
export type Rating = (typeof RATINGS)[number];

export const FLIGHT_TYPES = ["BUILD", "MAINT", "TEST", "SURVEY", "CHECK", "FERRY"] as const;
export type FlightType = (typeof FLIGHT_TYPES)[number];

export const WAKES = ["L", "M", "H", "J"] as const;
export type Wake = (typeof WAKES)[number];
// AIRPORT 슬롯에서 차지하는 몫. J는 배정하지 않는다(나눠야 함).
export const WAKE_SLOTS: Record<Wake, number> = { L: 0.5, M: 1, H: 2, J: Infinity };

export interface CrewMember {
  position: string; // backend, ui-builder, ui-qa, flash-helper …
  agent: string; // 모델이나 에이전트 타입
  limits?: string[]; // "no SEC", "no BUILD", "no CHECK verdicts", "read-only"
}
export interface Targets {
  flightsPerWeek?: number;
  onTime?: number; // 0~1
}
export interface AircraftProfile {
  base?: string | null;
  complement?: CrewMember[];
  ratings?: Rating[];
  routes?: string[];
  targets?: Targets;
  note?: string;
  configuration?: ConfigurationId; // ENTRY INTO SERVICE 때 고른 템플릿(기록용)
  enteredAt?: string; // ENTRY INTO SERVICE 시각
  aog?: { reason: string; until?: string | null; at: string }; // 잠시 운항 중지: planner가 배정하지 않는다
  retired?: { at: string; reason?: string | null }; // 퇴역: FLEET에서 빠지고 배정하지 않는다
  account?: string; // ACCOUNT(ATC-51, docs/fuel.md 6): SUPERVISOR가 정한 요금제 라벨(main, pro-2 …). email은 쓰지 않는다
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

// 한 팀의 실제 프로필(정하지 않은 항목은 기본값)
export function profileOf(fleet: FleetFile, registration: string) {
  const p = Object.entries(fleet.aircraft).find(([k]) => k.toUpperCase() === registration.toUpperCase())?.[1] ?? {};
  return {
    complement: p.complement ?? fleet.defaults.complement,
    ratings: p.ratings ?? fleet.defaults.ratings,
    routes: p.routes ?? [],
    aog: p.aog ?? null,
    retired: p.retired ?? null,
    account: accountOf(fleet, registration),
  };
}

// ACCOUNT(ATC-51): 라벨이 없는 AIRCRAFT는 기본 ACCOUNT다. 등록부에 라벨이 하나도 없으면 atc는 계정을 모른다(null)
export const DEFAULT_ACCOUNT = "default";
export const ACCOUNT_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
export const accountsLabeled = (fleet: Pick<FleetFile, "aircraft">) => Object.values(fleet.aircraft).some((p) => typeof p?.account === "string" && p.account);
export function accountOf(fleet: Pick<FleetFile, "aircraft">, registration: string): string | null {
  if (!accountsLabeled(fleet)) return null;
  const p = Object.entries(fleet.aircraft).find(([k]) => k.toUpperCase() === registration.toUpperCase())?.[1];
  return p?.account || DEFAULT_ACCOUNT;
}

// CONFIGURATION: 새 AIRCRAFT를 들일 때 고르는 팀 구성 템플릿. vocado 팀원 규칙 안에서 조합한다.
export const CONFIGURATIONS = {
  general: {
    label: "일반",
    complement: DEFAULT_FLEET.defaults.complement,
    ratings: ["UI", "DATA", "DOCS"] as Rating[],
  },
  security: {
    label: "보안·DB",
    complement: [
      { position: "backend", agent: "claude-opus-5-5" },
      { position: "reviewer", agent: "codex (GitHub 리뷰)", limits: ["read-only"] },
    ] as CrewMember[],
    ratings: ["SEC", "DATA", "DOCS"] as Rating[],
  },
  ui: {
    label: "UI",
    complement: [
      { position: "backend", agent: "claude-opus-5-5" },
      { position: "ui-builder", agent: "ui-builder" },
      { position: "ui-qa", agent: "ui-qa", limits: ["read-only"] },
    ] as CrewMember[],
    ratings: ["UI", "DOCS"] as Rating[],
  },
  research: {
    label: "리서치·문서",
    complement: [
      { position: "backend", agent: "claude-opus-5-5" },
      { position: "flash-helper", agent: "flash-helper", limits: ["no BUILD", "no CHECK verdicts", "no SEC"] },
    ] as CrewMember[],
    ratings: ["DATA", "DOCS"] as Rating[],
  },
} as const;
export type ConfigurationId = keyof typeof CONFIGURATIONS;

const can = (m: CrewMember, limit: string) => !(m.limits ?? []).includes(limit) && !(m.limits ?? []).includes("read-only");

// SEC는 보안 작업을 맡을 수 있는 팀원(flash-helper가 아니고 "no SEC" 제약이 없는)이 있어야 준다.
export function canHoldSec(complement: CrewMember[]): boolean {
  return complement.some((m) => m.agent !== "flash-helper" && !(m.limits ?? []).includes("no SEC"));
}

// 이 CREW가 그 FLIGHT TYPE을 날 수 있나. BUILD·MAINT·TEST는 구현할 팀원, CHECK는 판정할 팀원이 있어야 한다.
// SURVEY·FERRY는 누구나(flash-helper의 보안 금지는 TYPE RATING 쪽에서 막는다).
export function canFly(complement: CrewMember[], type: FlightType): boolean {
  if (type === "SURVEY" || type === "FERRY") return complement.length > 0;
  const limit = type === "CHECK" ? "no CHECK verdicts" : "no BUILD";
  return complement.some((m) => m.agent !== "flash-helper" && can(m, limit));
}

// SURVEY·CHECK는 STAND(워크트리)가 필요 없다 — 다른 FLIGHT의 STAND를 쥔 HOLDING 팀도 받을 수 있다.
export const needsStand = (type: FlightType) => type !== "SURVEY" && type !== "CHECK";

export interface Classification {
  type: FlightType;
  wake: Wake;
  ratings: Rating[]; // 이 FLIGHT에 필요한 TYPE RATING
  explicit: { type: boolean; wake: boolean }; // 라벨로 정해졌나(아니면 기본값)
  sources: string[]; // 판정에 쓴 라벨
}

// Linear 라벨을 읽는다. 라벨 그룹의 하위 라벨은 "그룹:이름"으로 들어온다(sources/linear.ts).
// - `type:BUILD` … `type:FERRY`, `wake:L` … `wake:J`, `rating:SEC` …
// - vocado의 기존 Risk 라벨(`Risk:Security` 그룹 하위, 옛 단독 라벨 `Risk: Security`)은 모두 SEC가 필요하다.
export function classOf(labels: string[]): Classification {
  let type: FlightType = "BUILD";
  let wake: Wake = "M";
  const ratings = new Set<Rating>();
  const explicit = { type: false, wake: false };
  const sources: string[] = [];
  for (const raw of labels) {
    const m = /^([^:]+):\s*(.+)$/.exec(raw.trim());
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim().toUpperCase();
    if (key === "type" && (FLIGHT_TYPES as readonly string[]).includes(value)) {
      type = value as FlightType;
      explicit.type = true;
      sources.push(raw);
    } else if (key === "wake" && (WAKES as readonly string[]).includes(value)) {
      wake = value as Wake;
      explicit.wake = true;
      sources.push(raw);
    } else if (key === "rating" && (RATINGS as readonly string[]).includes(value)) {
      ratings.add(value as Rating);
      sources.push(raw);
    } else if (key === "risk") {
      ratings.add("SEC");
      sources.push(raw);
    }
  }
  return { type, wake, ratings: RATINGS.filter((r) => ratings.has(r)), explicit, sources };
}

// 카드·FIDS에 붙이는 짧은 표기: "BUILD · M · SEC"
export const classLabel = (c: Classification) => [c.type, c.wake, ...c.ratings].join(" · ");
