import { DEFAULT_DISPATCH_CONFIG, loadDispatchConfig } from "./dispatch.ts";
import { readPrices } from "./fuel-prices.ts";
import { analyzeWindow, freshEnough, fuelChangeSeq, scanFuel } from "./fuel-run.ts";
import { loadLogbook } from "./logbook.ts";
import { type ColdCache, coldCachesOf, LARGE_LEAK_HOURS, type LargeLeak, largeLeaksOf } from "./fuel-view.ts";
import type { Snapshot } from "./model.ts";

// FUEL F8(ATC-56): TOWER·OCC 브리핑에 붙일 FUEL 경고. 대화 기록을 지난 LARGE_LEAK_HOURS 동안 바뀐 파일만(파일마다 지난번 바이트 뒤부터) 읽는다.
// 경고만 한다: CLEARANCE·FLIGHT PLAN을 막지 않고 DISPATCH 점수에 쓰지 않는다. 브리핑이 자주 불려 WATCH_MS 동안 같은 값을 쓴다.

export interface FuelWatch {
  at: string;
  largeLeaks: LargeLeak[];
  coldCache: ColdCache[];
  error: string | null;
}

const WATCH_MS = 60_000;
let last: { at: number; seq: number; value: FuelWatch } | null = null;

export function fuelWatch(s: Pick<Snapshot, "sessions" | "claims" | "workspaces" | "airports">, now = Date.now()): FuelWatch {
  if (last && freshEnough(last, now, WATCH_MS)) return last.value;
  const seq = fuelChangeSeq();
  let value: FuelWatch;
  try {
    const team = new RegExp(loadDispatchConfig().teamPattern ?? DEFAULT_DISPATCH_CONFIG.teamPattern, "i");
    const since = now - LARGE_LEAK_HOURS * 3_600_000;
    const scan = scanFuel(since, s.sessions);
    const prices = readPrices().table;
    // F3·F7 규칙(SESSION CHANGE 포함)으로 GET /api/fuel과 같게 센다
    const leaks = analyzeWindow(scan, s, loadLogbook(), since, now, prices).leaks.map((e) => ({ ...e, name: scan.names.get(e.session) ?? null }));
    const holding = s.sessions
      .filter((x) => x.agent === "claude" && x.status === "idle" && team.test(x.name) && s.claims.some((c) => c.sessionId === x.id && c.state === "active"))
      .map((x) => ({ session: x.id, name: x.name, lastActiveAt: x.lastActiveAt }));
    value = {
      at: new Date(now).toISOString(),
      largeLeaks: largeLeaksOf(leaks, (name) => team.test(name), now),
      coldCache: coldCachesOf(holding, scan.records.values(), now, prices),
      error: null,
    };
  } catch (e) {
    value = { at: new Date(now).toISOString(), largeLeaks: [], coldCache: [], error: String((e as Error).message ?? e).split("\n")[0] };
  }
  last = { at: now, seq, value };
  return value;
}
