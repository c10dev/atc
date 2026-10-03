import type { Ticket } from "./model.ts";

// K3 hold의 오작동 수(ATC-398, docs/autonomy.md 원칙 5·C9). 순수 함수만.
//   nuisance — 선언한 효과가 없는 K3 줄(`K3: none`)에 걸려 hold된 FLIGHT. 지금 걸려 있는 수(줄을 지우면 사라진다)
//   miss     — allow 없이 떠난 K3 FLIGHT(LAUNCH 기록에 k3가 없다)가 classifier 거부로 멈춘 AIRCRAFT(세션 health DENIED). 7일 안의 LAUNCH만 센다
export interface K3Launch {
  t: string;
  aircraft: string; // REGISTRATION
  flight: string;
  withAllow: boolean; // LAUNCH 기록에 k3(allow 항목)가 있다
}
export interface K3Misfires {
  nuisance: string[]; // FLIGHT key
  miss: { flight: string; aircraft: string; t: string }[];
}

export function k3MisfiresOf(input: { tickets: readonly Pick<Ticket, "key" | "stateType" | "k3Check" | "k3">[]; launches: readonly K3Launch[]; denied: ReadonlySet<string> }): K3Misfires {
  const open = input.tickets.filter((t) => t.stateType !== "completed" && t.stateType !== "canceled");
  const nuisance = open.filter((t) => t.k3Check && t.k3Check.unparsed > 0 && t.k3Check.unparsed === t.k3Check.none && !(t.k3 ?? []).length).map((t) => t.key);
  const k3Keys = new Set(input.tickets.filter((t) => t.k3Check?.lines).map((t) => t.key));
  const last = new Map<string, K3Launch>(); // AIRCRAFT마다 마지막 LAUNCH
  for (const l of [...input.launches].sort((a, b) => a.t.localeCompare(b.t))) last.set(l.aircraft, l);
  const miss = [...last.values()].filter((l) => k3Keys.has(l.flight) && !l.withAllow && input.denied.has(l.aircraft)).map((l) => ({ flight: l.flight, aircraft: l.aircraft, t: l.t }));
  return { nuisance: nuisance.sort(), miss };
}
