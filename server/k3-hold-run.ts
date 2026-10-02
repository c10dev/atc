import { regKey } from "./registration.ts";
import type { Snapshot } from "./model.ts";
import { readRecords } from "./recorder.ts";
import { type K3Misfires, k3MisfiresOf } from "./k3-hold.ts";

const WINDOW_MS = 7 * 86_400_000;

// 지금 상태에서 센 K3 hold 오작동(읽기만). 세션 health가 DENIED인 AIRCRAFT와 최근 LAUNCH 기록을 견준다
export function k3MisfiresNow(s: Snapshot, teamPattern: string, now = Date.now()): K3Misfires {
  const launches = readRecords(now - WINDOW_MS).flatMap((r) => (r.kind === "fleet" && r.op === "launch" && r.ok && r.flight ? [{ t: r.t, aircraft: regKey(r.aircraft, teamPattern), flight: r.flight, withAllow: Boolean((r as { k3?: unknown }).k3) }] : []));
  const denied = new Set(s.sessions.filter((x) => x.health?.code === "DENIED").map((x) => regKey(x.name ?? "", teamPattern)));
  return k3MisfiresOf({ tickets: s.tickets, launches, denied });
}
