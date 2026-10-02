import { loadDispatchConfig } from "./dispatch.ts";
import { fleetView, loadFleet } from "./fleet.ts";
import { loadLogbook } from "./logbook.ts";
import type { Snapshot } from "./model.ts";
import { record, type RecordLine } from "./recorder.ts";
import { sameReg } from "./registration.ts";
import { stopAircraft } from "./session-control.ts";
import { staleStopOf } from "./stale-stop.ts";

// STALE STOP의 한 주기(ATC-369). 서버 안에서만 돈다 — HTTP 길도 atcctl 명령도 없고, 스위치(dispatch.json staleStop)는 SUPERVISOR가 설정 창에서만 끈다.
// 규칙은 stale-stop.ts(순수). 여기서는 읽고, 멈추고(stopAircraft: FLIGHT RECORDER에 fleet stop 줄이 by와 함께 남는다), policy 줄을 한 줄 더 남긴다.

const RETRY_MS = 10 * 60_000; // STOP이 실패한 REGISTRATION은 10분 쉰다
const tried = new Map<string, number>();
let running = false;

export interface StaleIO {
  mode: () => "on" | "off";
  facts: (s: Snapshot, now: number) => Parameters<typeof staleStopOf>[0][];
  stop: (reg: string, by: string) => Promise<{ ok: boolean; jobId?: string; error?: string }>;
  record: (l: RecordLine) => void;
}

const realIO = (): StaleIO => ({
  mode: () => loadDispatchConfig().staleStop,
  facts: (s, now) => {
    const cfg = loadDispatchConfig();
    const entries = loadLogbook();
    return fleetView(s, loadFleet(), cfg.teamPattern, [], now).map((a) => {
      const session = s.sessions.find((x) => x.status !== "dead" && x.kind === "background" && sameReg(x.name, a.registration, cfg.teamPattern));
      return {
        registration: a.registration,
        background: Boolean(session),
        health: a.health ?? null,
        startedAt: session?.startedAt ?? null,
        flights: (a.flights ?? []).map((f) => f.key),
        arrivals: entries.filter((e) => e.aircraft === a.registration).map((e) => ({ flight: e.flight, arrivedAt: e.arrivedAt })),
      };
    });
  },
  stop: async (reg, by) => {
    const r = await stopAircraft(reg, by);
    return r.ok ? { ok: true, ...(r.jobId ? { jobId: r.jobId } : {}) } : { ok: false, error: r.error };
  },
  record,
});

export interface StaleResult {
  stopped: string[];
  failed: string[];
}

export async function runStaleStop(s: Snapshot, now = Date.now(), io: StaleIO = realIO()): Promise<StaleResult> {
  const out: StaleResult = { stopped: [], failed: [] };
  if (io.mode() === "off" || running) return out;
  running = true;
  try {
    for (const f of io.facts(s, now)) {
      const v = staleStopOf(f, now);
      if (!v.stop) continue;
      const last = tried.get(f.registration);
      if (last !== undefined && now - last < RETRY_MS) continue;
      tried.set(f.registration, now);
      const r = await io.stop(f.registration, `auto stale-stop (${v.code} ${v.heldMin}m, ${v.flights.join(", ") || "FLIGHT done"})`);
      io.record({ t: new Date(now).toISOString(), kind: "policy", op: "stale-stop", aircraft: f.registration, ok: r.ok, code: v.code, heldMin: v.heldMin, flights: v.flights, ...(r.jobId ? { jobId: r.jobId } : {}), ...(r.error ? { error: r.error } : {}) });
      (r.ok ? out.stopped : out.failed).push(f.registration);
      if (r.ok) tried.delete(f.registration);
    }
  } finally {
    running = false;
  }
  return out;
}
